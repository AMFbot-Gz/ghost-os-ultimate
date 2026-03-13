/**
 * src/utils.js — Utilitaires purs LaRuche (sans effets de bord au chargement)
 * Importable dans les tests sans démarrer WebSocket/API
 */

import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
export const MISSIONS_FILE = join(ROOT, ".laruche/missions.json");

// ─── safeParseJSON ────────────────────────────────────────────────────────────
export const safeParseJSON = (text, fallback) => {
  const start = text.indexOf("{");
  if (start === -1) return fallback;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(text.slice(start, i + 1)); } catch { return fallback; }
      }
    }
  }
  return fallback;
};

// ─── Persistence missions ─────────────────────────────────────────────────────
let _missionsCache = null;

export function loadMissions() {
  if (_missionsCache) return _missionsCache;
  const dir = join(ROOT, ".laruche");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  try {
    _missionsCache = existsSync(MISSIONS_FILE)
      ? JSON.parse(readFileSync(MISSIONS_FILE, "utf-8"))
      : [];
  } catch {
    _missionsCache = [];
  }
  return _missionsCache;
}

export function saveMission(entry) {
  _missionsCache = [entry, ...loadMissions()].slice(0, 200);
  const tmp = `${MISSIONS_FILE}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(_missionsCache, null, 2));
    renameSync(tmp, MISSIONS_FILE);
  } catch (err) {
    console.error(`[WARN] saveMission failed: ${err.message}`);
  }
}

export const splitMsg = (text, max = 3900) => {
  const chunks = [];
  for (let i = 0; i < text.length; i += max) chunks.push(text.slice(i, i + max));
  return chunks.length ? chunks : [text];
};
