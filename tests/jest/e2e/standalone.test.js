/**
 * test/e2e/standalone.test.js — Tests E2E du mode Standalone
 *
 * Lance LaRuche en mode STANDALONE_MODE=true et teste l'API REST complète.
 * Ces tests nécessitent Ollama en fonctionnement.
 *
 * Usage : node test/e2e/standalone.test.js
 *         npm run test:standalone
 */

import { spawn } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import chalk from "chalk";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const API_PORT = process.env.API_PORT || "3001"; // Port différent pour les tests
const API = `http://localhost:${API_PORT}`;
const STARTUP_DELAY = 4000; // ms pour que LaRuche démarre

let laruche = null;
let passed = 0;
let failed = 0;

// ─── Utilitaires ──────────────────────────────────────────────────────────────

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function test(name, fn, timeoutMs = 30000) {
  process.stdout.write(`  ${chalk.dim("→")} ${name.padEnd(55)}`);
  const start = Date.now();
  try {
    await Promise.race([
      fn(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Timeout ${timeoutMs}ms`)), timeoutMs)
      ),
    ]);
    const ms = Date.now() - start;
    console.log(chalk.green("✅") + chalk.dim(` ${ms}ms`));
    passed++;
  } catch (e) {
    console.log(chalk.red("❌") + chalk.dim(` ${e.message?.slice(0, 80)}`));
    failed++;
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || "Assertion échouée");
}

async function apiGet(path) {
  const r = await fetch(`${API}${path}`, { signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);
  return r.json();
}

async function apiPost(path, body) {
  const r = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(`HTTP ${r.status}: ${err.error || r.statusText}`);
  }
  return r.json();
}

/**
 * Attend qu'une mission atteigne un état final
 */
async function waitForMission(missionId, maxWaitMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    await sleep(1000);
    try {
      const mission = await apiGet(`/api/missions/${missionId}`);
      if (mission.status === "success" || mission.status === "error") {
        return mission;
      }
    } catch {}
  }
  throw new Error(`Mission ${missionId} n'a pas terminé en ${maxWaitMs}ms`);
}

// ─── Démarrage de LaRuche en mode standalone ─────────────────────────────────

function startLaRuche() {
  return new Promise((resolve, reject) => {
    laruche = spawn("node", ["src/queen_oss.js"], {
      cwd: ROOT,
      env: {
        ...process.env,
        STANDALONE_MODE: "true",
        API_PORT: API_PORT,
        HUD_PORT: "9099", // Port différent pour les tests
        TELEGRAM_BOT_TOKEN: "",
        ADMIN_TELEGRAM_ID: "",
        NODE_ENV: "test",
        LOG_LEVEL: "warn",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let output = "";
    laruche.stdout.on("data", (d) => { output += d.toString(); });
    laruche.stderr.on("data", (d) => { output += d.toString(); });

    laruche.on("error", reject);

    // Attendre que l'API soit disponible
    const checkReady = async () => {
      for (let i = 0; i < 20; i++) {
        await sleep(500);
        try {
          const r = await fetch(`${API}/api/health`, { signal: AbortSignal.timeout(1000) });
          if (r.ok) { resolve(); return; }
        } catch {}
      }
      reject(new Error(`API non disponible après ${STARTUP_DELAY * 2}ms. Output: ${output.slice(-200)}`));
    };
    checkReady();
  });
}

function stopLaRuche() {
  if (laruche) {
    laruche.kill("SIGTERM");
    laruche = null;
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

console.log(chalk.hex("#F5A623").bold("\n🐝 LaRuche — Tests E2E Mode Standalone\n"));
console.log(chalk.dim(`  API Port: ${API_PORT}`));

// Démarrage
console.log(chalk.bold("\n  Démarrage"));
process.stdout.write(`  ${chalk.dim("→")} ${"Lancement LaRuche (STANDALONE_MODE=true)".padEnd(55)}`);
try {
  await startLaRuche();
  console.log(chalk.green("✅") + chalk.dim(` prêt`));
  passed++;
} catch (e) {
  console.log(chalk.red("❌") + chalk.dim(` ${e.message}`));
  failed++;
  console.log(chalk.red("\n  Impossible de démarrer LaRuche. Arrêt des tests.\n"));
  process.exit(1);
}

// ─── 1. Infrastructure ───────────────────────────────────────────────────────
console.log(chalk.bold("\n  Infrastructure"));

await test("GET / → liste des endpoints", async () => {
  const data = await apiGet("/");
  assert(Array.isArray(data.endpoints), "endpoints doit être un tableau");
  assert(data.mode === "standalone", `mode attendu 'standalone', reçu: ${data.mode}`);
  assert(data.endpoints.some((e) => e.includes("/api/mission")), "endpoint /api/mission manquant");
});

await test("GET /api/health → ok:true", async () => {
  const data = await apiGet("/api/health");
  assert(data.ok === true, "ok doit être true");
  assert(typeof data.ts === "number", "ts doit être un nombre");
});

await test("GET /api/status → informations système complètes", async () => {
  const data = await apiGet("/api/status");
  assert(data.status === "online", `status doit être 'online', reçu: ${data.status}`);
  assert(data.mode === "standalone", `mode doit être 'standalone', reçu: ${data.mode}`);
  assert(typeof data.uptime === "number", "uptime doit être un nombre");
  assert(data.missions !== undefined, "missions stats manquantes");
});

await test("GET /api/agents → liste des agents avec rôles", async () => {
  const data = await apiGet("/api/agents");
  assert(Array.isArray(data.agents), "agents doit être un tableau");
  assert(data.agents.length > 0, "Aucun agent détecté");
  const roles = data.agents.map((a) => a.role);
  assert(roles.includes("strategist") || roles.includes("worker"), "Rôles attendus manquants");
});

await test("GET /api/missions → liste paginée", async () => {
  const data = await apiGet("/api/missions");
  assert(Array.isArray(data.missions), "missions doit être un tableau");
  assert(typeof data.total === "number", "total doit être un nombre");
  assert(typeof data.page === "number", "page doit être un nombre");
});

// ─── 2. Validation des inputs ─────────────────────────────────────────────────
console.log(chalk.bold("\n  Validation"));

await test("POST /api/mission sans body → 400", async () => {
  const r = await fetch(`${API}/api/mission`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  assert(r.status === 400, `Attendu 400, reçu ${r.status}`);
  const err = await r.json();
  assert(err.error, "Message d'erreur manquant");
});

await test("POST /api/mission avec command trop longue → 400", async () => {
  const r = await fetch(`${API}/api/mission`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ command: "a".repeat(2001) }),
  });
  assert(r.status === 400, `Attendu 400, reçu ${r.status}`);
});

await test("GET /api/missions/:id inexistant → 404", async () => {
  const r = await fetch(`${API}/api/missions/m-999-inexistant`);
  assert(r.status === 404, `Attendu 404, reçu ${r.status}`);
});

await test("Route inconnue → 404", async () => {
  const r = await fetch(`${API}/api/nonexistent`);
  assert(r.status === 404, `Attendu 404, reçu ${r.status}`);
});

// ─── 3. CORS ──────────────────────────────────────────────────────────────────
console.log(chalk.bold("\n  CORS"));

await test("OPTIONS /api/mission → headers CORS présents", async () => {
  const r = await fetch(`${API}/api/mission`, { method: "OPTIONS" });
  const origin = r.headers.get("access-control-allow-origin");
  assert(origin, "Header Access-Control-Allow-Origin manquant");
});

// ─── 4. Missions réelles (nécessite Ollama) ────────────────────────────────────
const ollamaAvailable = await fetch(
  `${process.env.OLLAMA_HOST || "http://localhost:11434"}/api/tags`,
  { signal: AbortSignal.timeout(2000) }
).then((r) => r.ok).catch(() => false);

if (ollamaAvailable) {
  console.log(chalk.bold("\n  Missions (Ollama disponible)"));

  await test("POST /api/mission → missionId + status pending (202)", async () => {
    const data = await apiPost("/api/mission", { command: "Dis juste 'OK' en une ligne." });
    assert(data.missionId, "missionId manquant");
    assert(data.status === "pending", `status attendu 'pending', reçu: ${data.status}`);
    assert(data.missionId.startsWith("m-"), `missionId format incorrect: ${data.missionId}`);
  }, 10000);

  await test("Mission complète de bout en bout", async () => {
    const start = await apiPost("/api/mission", {
      command: "Réponds uniquement: LARUCHE_TEST_OK",
    });
    assert(start.missionId, "missionId manquant");

    const mission = await waitForMission(start.missionId, 90000);
    assert(mission.status === "success", `Mission échouée: ${mission.error}`);
    assert(mission.result?.length > 0, "Résultat vide");
    assert(mission.duration > 0, "Durée invalide");
  }, 95000);

  await test("GET /api/missions/:id — mission en cours (running)", async () => {
    const start = await apiPost("/api/mission", { command: "Liste 5 fruits" });
    // Requête immédiate → devrait être pending ou running
    await sleep(200);
    const mission = await apiGet(`/api/missions/${start.missionId}`);
    assert(
      ["pending", "running", "success"].includes(mission.status),
      `Status inattendu: ${mission.status}`
    );
  }, 90000);

  await test("POST /api/search → résultats correspondants", async () => {
    const data = await apiPost("/api/search", { query: "LARUCHE" });
    assert(Array.isArray(data.results), "results doit être un tableau");
    assert(typeof data.count === "number", "count doit être un nombre");
  }, 10000);

} else {
  console.log(chalk.bold("\n  Missions"));
  console.log(chalk.yellow("  ⚠️  Ollama non disponible — tests de missions ignorés"));
}

// ─── 5. Résistance aux pannes ─────────────────────────────────────────────────
console.log(chalk.bold("\n  Robustesse"));

await test("JSON malformé → 400 sans crash du serveur", async () => {
  const r = await fetch(`${API}/api/mission`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{ invalid json !!!",
  });
  assert(r.status === 400, `Attendu 400, reçu ${r.status}`);
  // Vérifier que le serveur est toujours opérationnel
  const health = await apiGet("/api/health");
  assert(health.ok, "Serveur planté après JSON invalide");
});

await test("Requêtes parallèles (10 simultanées)", async () => {
  const requests = Array(10).fill(0).map(() => apiGet("/api/health"));
  const results = await Promise.all(requests);
  assert(results.every((r) => r.ok === true), "Certaines requêtes parallèles ont échoué");
});

// ─── Résultat final ───────────────────────────────────────────────────────────
stopLaRuche();

console.log();
const total = passed + failed;
const pct = total > 0 ? Math.round((passed / total) * 100) : 0;
const bar = "█".repeat(Math.round(pct / 5)) + "░".repeat(20 - Math.round(pct / 5));

console.log(`  ${bar} ${pct}%`);
console.log(`  ${chalk.green(`✅ ${passed} passés`)}  ${failed > 0 ? chalk.red(`❌ ${failed} échoués`) : chalk.dim("❌ 0 échoué")}\n`);

if (failed > 0) process.exit(1);
