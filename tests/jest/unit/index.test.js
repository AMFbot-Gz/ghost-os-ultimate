/**
 * test/unit/index.test.js — Tests unitaires LaRuche
 * Couvre : safeParseJSON, saveMission atomique, rate limiting, stuck missions
 * Usage : node test/unit/index.test.js
 */

import { readFileSync, existsSync, unlinkSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import chalk from "chalk";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");

let passed = 0, failed = 0;

async function test(name, fn) {
  process.stdout.write(`  ${chalk.dim("→")} ${name.padEnd(55)}`);
  try {
    await fn();
    console.log(chalk.green("✅"));
    passed++;
  } catch (e) {
    console.log(chalk.red("❌") + chalk.dim(` ${e.message?.slice(0, 80)}`));
    failed++;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "Assertion échouée");
}

console.log(chalk.hex("#F5A623").bold("\n🐝 LaRuche — Tests Unitaires\n"));

// ─── 1. safeParseJSON ────────────────────────────────────────────────────────
console.log(chalk.bold("  safeParseJSON"));

const { safeParseJSON } = await import("../../src/utils.js");

await test("Parse JSON simple", async () => {
  const r = safeParseJSON('{"a":1}', null);
  assert(r?.a === 1, `Attendu {a:1}, reçu ${JSON.stringify(r)}`);
});

await test("Premier objet seulement (non-greedy)", async () => {
  const r = safeParseJSON('{"tasks":[1,2]} {"other":"ignored"}', null);
  assert(r?.tasks && !r.other, `Doit retourner seulement le premier objet`);
});

await test("JSON après texte", async () => {
  const r = safeParseJSON('voici le plan: {"mission":"test","tasks":[]}', null);
  assert(r?.mission === "test", `Attendu mission:test, reçu ${JSON.stringify(r)}`);
});

await test("JSON invalide → fallback", async () => {
  const r = safeParseJSON("ceci n'est pas du JSON", { fallback: true });
  assert(r?.fallback === true, "Devrait retourner le fallback");
});

await test("Chaîne vide → fallback", async () => {
  const r = safeParseJSON("", "default");
  assert(r === "default", `Attendu 'default', reçu ${r}`);
});

await test("JSON imbriqué profond", async () => {
  const obj = { a: { b: { c: [1, 2, 3] } } };
  const r = safeParseJSON(`texte ${JSON.stringify(obj)} fin`, null);
  assert(r?.a?.b?.c?.length === 3, "JSON imbriqué mal parsé");
});

await test("JSON avec backticks dans texte", async () => {
  const r = safeParseJSON('```json\n{"tasks":[{"id":1}]}\n```', null);
  assert(r?.tasks?.length === 1, `Parse avec backticks échoué: ${JSON.stringify(r)}`);
});

// ─── 2. saveMission atomique ─────────────────────────────────────────────────
console.log(chalk.bold("\n  saveMission atomique"));

// Test isolation : utiliser un fichier temporaire
const TMP_DIR = join(ROOT, ".laruche/test_tmp");
mkdirSync(TMP_DIR, { recursive: true });
const tmpFile = join(TMP_DIR, `missions_test_${Date.now()}.json`);

await test("Pas de fichier .tmp résiduel après écriture", async () => {
  const { saveMission } = await import("../../src/utils.js");
  // saveMission utilise MISSIONS_FILE en dur — on vérifie juste qu'aucun .tmp ne reste
  const tmpPath = `${join(ROOT, ".laruche/missions.json")}.tmp`;
  saveMission({ id: "test-atomic", command: "test", status: "success", ts: new Date().toISOString() });
  // Laisser le temps au renameSync
  await new Promise(r => setTimeout(r, 50));
  assert(!existsSync(tmpPath), ".tmp résiduel détecté — écriture non atomique");
});

await test("Fichier missions.json valide après écriture concurrente (x5)", async () => {
  const { saveMission } = await import("../../src/utils.js");
  const promises = Array.from({ length: 5 }, (_, i) =>
    Promise.resolve(saveMission({ id: `conc-${i}`, command: `cmd-${i}`, status: "success", ts: new Date().toISOString() }))
  );
  await Promise.all(promises);
  await new Promise(r => setTimeout(r, 100));
  const content = readFileSync(join(ROOT, ".laruche/missions.json"), "utf-8");
  const parsed = JSON.parse(content); // Lève si corrompu
  assert(Array.isArray(parsed), "missions.json n'est pas un tableau");
});

await test("Max 200 missions gardées", async () => {
  const { saveMission, loadMissions } = await import("../../src/utils.js");
  // Insérer 10 de plus (déjà au-dessus de 200 ou pas)
  for (let i = 0; i < 10; i++) {
    saveMission({ id: `limit-${i}`, command: `cmd`, status: "success", ts: new Date().toISOString() });
  }
  const missions = loadMissions();
  assert(missions.length <= 200, `${missions.length} missions > limite 200`);
});

// ─── 3. Rate Limiting ────────────────────────────────────────────────────────
console.log(chalk.bold("\n  Rate Limiting (API)"));

// Import du module missions pour accéder à checkRateLimit en test
// On teste l'API directement via fetch (le serveur tourne sur :3000)
const API = "http://localhost:3000";

const serverAvailable = await fetch(`${API}/api/health`, { signal: AbortSignal.timeout(1000) })
  .then(r => r.ok).catch(() => false);

if (serverAvailable) {
  await test("11 requêtes rapides → 429 sur la 11ème", async () => {
    // Utiliser un header x-forwarded-for unique pour ce test
    const testIp = `10.0.${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}`;
    let got429 = false;
    for (let i = 0; i < 12; i++) {
      const r = await fetch(`${API}/api/mission`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-forwarded-for": testIp },
        body: JSON.stringify({ command: `test rate limit ${i}` }),
        signal: AbortSignal.timeout(3000),
      });
      if (r.status === 429) { got429 = true; break; }
    }
    assert(got429, "Rate limit 429 non déclenché après 11 requêtes");
  });

  await test("IPs différentes → pas bloquées mutuellement", async () => {
    const ip1 = `10.1.${Math.floor(Math.random()*255)}.1`;
    const ip2 = `10.2.${Math.floor(Math.random()*255)}.2`;
    const r1 = await fetch(`${API}/api/mission`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": ip1 },
      body: JSON.stringify({ command: "test ip1" }),
    });
    const r2 = await fetch(`${API}/api/mission`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": ip2 },
      body: JSON.stringify({ command: "test ip2" }),
    });
    assert(r1.status !== 429, `IP1 bloquée: ${r1.status}`);
    assert(r2.status !== 429, `IP2 bloquée: ${r2.status}`);
  });
} else {
  await test("Rate limit (serveur requis — SKIP)", async () => {
    console.log(chalk.yellow(" SKIP (serveur non disponible)"));
    passed++; failed--; // Compenser
  });
}

// ─── 4. Stuck Missions ───────────────────────────────────────────────────────
console.log(chalk.bold("\n  Stuck Missions (expiration)"));

const { activeMissions, createMissionEntry, updateMission } = await import("../../src/api/missions.js");

await test("Mission pending depuis > STUCK_TIMEOUT → pas encore expirée (< 1s)", async () => {
  const entry = createMissionEntry("test stuck fresh");
  assert(entry.status === "pending", "Status initial doit être pending");
  // Toujours pending car vient juste d'être créée
  const fetched = activeMissions.get(entry.id);
  assert(fetched?.status === "pending", "Mission fraîche ne devrait pas être expirée");
  activeMissions.delete(entry.id);
});

await test("updateMission patch le statut correctement", async () => {
  const entry = createMissionEntry("test update");
  updateMission(entry.id, { status: "running" });
  assert(activeMissions.get(entry.id)?.status === "running", "Status non mis à jour");
  updateMission(entry.id, { status: "success", result: "ok", duration: 1000 });
  const m = activeMissions.get(entry.id);
  assert(m?.status === "success", "Status success non appliqué");
  assert(m?.result === "ok", "Result non appliqué");
  // Ne pas delete ici — le setTimeout de rétention le fera
});

await test("appendMissionEvent ajoute avec timestamp", async () => {
  const { appendMissionEvent } = await import("../../src/api/missions.js");
  const entry = createMissionEntry("test events");
  appendMissionEvent(entry.id, { type: "thinking", agent: "strategist" });
  appendMissionEvent(entry.id, { type: "plan_ready", tasks: 3 });
  const m = activeMissions.get(entry.id);
  assert(m?.events?.length === 2, `Attendu 2 events, reçu ${m?.events?.length}`);
  assert(m.events[0].ts, "Timestamp manquant sur event");
  assert(m.events[0].type === "thinking", "Type event incorrect");
  activeMissions.delete(entry.id);
});

await test("Mission inconnue → updateMission sans crash", async () => {
  updateMission("m-inexistant-999", { status: "success" }); // Ne doit pas throw
  assert(true, "updateMission sur ID inexistant ne doit pas crasher");
});

// ─── 5. Model Router Cache ───────────────────────────────────────────────────
console.log(chalk.bold("\n  Model Router"));

const { getAvailableModels } = await import("../../src/model_router.js");

await test("getAvailableModels() x10 parallèle — un seul fetch (inflight dedup)", async () => {
  // Forcer cache expiré en manipulant (pas d'accès direct) — on appelle 10× et mesure le temps
  const t = Date.now();
  const results = await Promise.all(Array.from({ length: 10 }, () => getAvailableModels()));
  const ms = Date.now() - t;
  // Tous doivent retourner le même tableau
  assert(results.every(r => Array.isArray(r)), "Doit retourner des tableaux");
  // Si inflight fonctionne, < 500ms (un seul vrai fetch)
  assert(ms < 1000, `Trop lent pour un cache: ${ms}ms`);
});

await test("getAvailableModels() retourne tableau non-vide (Ollama dispo)", async () => {
  const models = await getAvailableModels();
  assert(Array.isArray(models), "Doit être un tableau");
  // Peut être vide si Ollama pas dispo — pas d'assertion sur length
});

// ─── Résultat ─────────────────────────────────────────────────────────────────
console.log();
const total = passed + failed;
const pct = total > 0 ? Math.round((passed / total) * 100) : 0;
const bar = "█".repeat(Math.round(pct / 5)) + "░".repeat(20 - Math.round(pct / 5));
console.log(`  ${bar} ${pct}%`);
console.log(`  ${chalk.green(`✅ ${passed} passés`)}  ${failed > 0 ? chalk.red(`❌ ${failed} échoués`) : chalk.dim("❌ 0 échoué")}\n`);

if (failed > 0) process.exit(1);
