/**
 * memory_store.js - Stockage actif des expériences dans MEMORY.md + vault
 *
 * Appelé après chaque mission/pipeline pour enrichir la mémoire longue durée.
 * Extrait les patterns importants et les fusionne dans workspace/memory/MEMORY.md
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const MEMORY_PATH = join(ROOT, "workspace/memory/MEMORY.md");
const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://localhost:11434";

// --- Lecture/écriture MEMORY.md ----------------------------------------------

function loadMemory() {
  if (!existsSync(MEMORY_PATH)) return { raw: "", entries: [] };
  const raw = readFileSync(MEMORY_PATH, "utf-8");
  // Parser les blocs ```yaml...``` comme entries pour cohérence avec le cas "fichier absent"
  const entries = [];
  const blockRe = /```yaml\n([\s\S]*?)```/g;
  let m;
  while ((m = blockRe.exec(raw)) !== null) {
    try {
      const obj = {};
      for (const line of m[1].split('\n')) {
        const colonIdx = line.indexOf(':');
        if (colonIdx === -1) continue;
        const k = line.slice(0, colonIdx).trim();
        const v = line.slice(colonIdx + 1).trim();
        if (k) obj[k] = v;
      }
      if (obj.id) entries.push(obj);
    } catch { /* bloc malformé ignoré */ }
  }
  return { raw, entries };
}

// Mutex léger anti-race condition pour les écritures MEMORY.md
let _writeLock = Promise.resolve();

function appendMemory(entry) {
  // Chaîner les écritures pour éviter les race conditions concurrent
  _writeLock = _writeLock.then(() => {
    const mem = loadMemory();
    const timestamp = new Date().toISOString().split("T")[0];

    const newBlock = `
---
\`\`\`yaml
id: mem_${Date.now()}
type: ${entry.type || "rule"}
scope: ${entry.scope || "global"}
tags: [${(entry.tags || []).join(", ")}]
created: ${timestamp}
confidence: ${entry.confidence || "medium"}
\`\`\`
${entry.content}
`;

    const currentContent = mem.raw || "# LaRuche Memory\n\n";
    writeFileSync(MEMORY_PATH, currentContent + newBlock);
  }).catch(err => {
    console.error("[memory_store] Erreur écriture MEMORY.md:", err.message);
  });
  return _writeLock;
}

// --- Extraction de leçon via LLM ---------------------------------------------

async function extractLesson(mission) {
  const { goal, steps, success, duration } = mission;
  if (!steps || steps.length === 0) return null;

  const failedSteps = steps.filter(s => s.result?.success === false);
  if (success && failedSteps.length === 0) return null;

  const prompt = `Une mission LaRuche vient de se terminer. Objectif: ${goal} Succès: ${success} Étapes: ${steps.map(s => `${s.step?.skill}(${JSON.stringify(s.step?.params || {})}) -> ${s.result?.success !== false ? "OK" : "ECHEC: " + (s.result?.error || "?")}`).join(", ")} Durée: ${(duration / 1000).toFixed(1)}s Si cette mission a échoué ou pourrait être améliorée, quelle règle générale peut-on en déduire? Sinon, SKIP.`;

  try {
    const res = await fetch(`${OLLAMA_HOST}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "llama3.2:3b", prompt, stream: false, options: { temperature: 0.3 } }),
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json();
    const lesson = data.response?.trim();
    if (!lesson || lesson === "SKIP" || lesson.toLowerCase().includes("skip")) return null;
    return lesson;
  } catch {
    return null;
  }
}

// --- API principale with Debounce logic --------------------------------------

let _lastStoredMissionId = null;
let _storageTimeout = null;

process.on("exit", () => { if (_storageTimeout) clearTimeout(_storageTimeout); });

export async function storeMissionMemory(mission) {
  const missionId = `${mission.goal}_${mission.success}_${mission.steps?.length}`;
  if (_lastStoredMissionId === missionId) return;

  if (_storageTimeout) clearTimeout(_storageTimeout);

  _storageTimeout = setTimeout(async () => {
    _lastStoredMissionId = missionId;
    try {
      const { execa } = await import("execa");
      const rpc = JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "storeExperience",
          arguments: {
            task: mission.goal || "",
            result: JSON.stringify(mission.steps?.slice(0, 3) || []).slice(0, 200),
            success: mission.success !== false,
            skillUsed: mission.steps?.[0]?.step?.skill || "unknown",
          },
        },
      });

      await execa("node", [join(ROOT, "mcp_servers/vault_mcp.js")], {
        input: rpc,
        cwd: ROOT,
        timeout: 10000,
        reject: false,
      }).catch(() => {});

      const lesson = await extractLesson(mission);
      if (lesson) {
        mkdirSync(join(ROOT, "workspace/memory"), { recursive: true });
        appendMemory({
          type: "error_lesson",
          scope: "global",
          tags: ["auto-learned", "pipeline"],
          confidence: "medium",
          content: lesson,
        });
      }
    } catch { /* non-fatal */ }
  }, 1000);
}

export async function storeRule(rule, tags = [], scope = "global") {
  appendMemory({ type: "rule", scope, tags, confidence: "high", content: rule });
}
