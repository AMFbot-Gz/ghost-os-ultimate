/**
 * src/laruche-sync.js — LaRuche ↔ Jarvis Sync Bidirectionnel
 * Synchronise skills + mémoire entre les deux systèmes
 * API sur :3007
 *
 * Sync toutes les 5 minutes :
 * 1. Skills LaRuche → ghost-os-ultimate (si plus récents)
 * 2. Épisodes mémoire → POST vers LaRuche memory si disponible
 * 3. Registry partagé (lecture)
 */

import { createServer } from 'http';
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync, copyFileSync } from 'fs';
import { resolve, join, dirname } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT       = resolve(__dirname, '..');
const DATA_DIR   = resolve(ROOT, 'data');
const SKILLS_DIR = resolve(ROOT, 'skills');

const PORT        = parseInt(process.env.LARUCHE_SYNC_PORT || '3007');
const LARUCHE_URL = process.env.LARUCHE_URL || 'http://localhost:3000';
const GHOST_URL   = `http://localhost:${process.env.API_PORT || '3002'}`;

// Chemins possibles pour les skills LaRuche
const LARUCHE_ROOTS = [
  resolve(process.env.HOME, 'LaRuche'),
  resolve(process.env.HOME, 'Projects/LaRuche'),
  resolve(process.env.HOME, 'Projects/la-ruche'),
];

const LARUCHE_SKILL_PATHS = [
  'skills/core',
  'skills',
  'workspace/skills',
];

// État sync
const syncState = {
  lastSync: null,
  skillsSynced: 0,
  episodesSynced: 0,
  laruche_online: false,
  errors: [],
};

// ─── Trouver les skills LaRuche ──────────────────────────────────────────────

function findLaRucheSkills() {
  const found = [];
  for (const root of LARUCHE_ROOTS) {
    if (!existsSync(root)) continue;
    for (const sp of LARUCHE_SKILL_PATHS) {
      const skillsDir = join(root, sp);
      if (!existsSync(skillsDir)) continue;
      try {
        const dirs = readdirSync(skillsDir);
        for (const d of dirs) {
          const skillPath = join(skillsDir, d);
          try {
            if (!statSync(skillPath).isDirectory()) continue;
            const skillJs = join(skillPath, 'skill.js');
            const manifestJson = join(skillPath, 'manifest.json');
            if (existsSync(skillJs)) {
              found.push({ name: d, path: skillPath, hasManifest: existsSync(manifestJson) });
            }
          } catch {}
        }
      } catch {}
    }
    if (found.length > 0) break;
  }
  return found;
}

// ─── Sync skills LaRuche → ghost-os-ultimate ────────────────────────────────

async function syncSkills() {
  const laRucheSkills = findLaRucheSkills();
  let copied = 0;

  for (const skill of laRucheSkills) {
    const target = join(SKILLS_DIR, skill.name);
    const srcSkill = join(skill.path, 'skill.js');
    const srcManifest = join(skill.path, 'manifest.json');

    // Si skill déjà présent dans ghost-os → comparer dates
    if (existsSync(target)) {
      const targetSkill = join(target, 'skill.js');
      if (existsSync(targetSkill)) {
        const srcMtime = statSync(srcSkill).mtimeMs;
        const dstMtime = statSync(targetSkill).mtimeMs;
        if (srcMtime <= dstMtime) continue; // ghost-os est plus récent → skip
      }
    } else {
      mkdirSync(target, { recursive: true });
    }

    try {
      copyFileSync(srcSkill, join(target, 'skill.js'));
      if (skill.hasManifest) copyFileSync(srcManifest, join(target, 'manifest.json'));
      copied++;
    } catch (e) {
      syncState.errors.push(`syncSkills: ${skill.name} — ${e.message}`);
    }
  }

  // Reconstruire registry si des skills ont été copiés
  if (copied > 0) {
    rebuildRegistry();
  }

  syncState.skillsSynced = copied;
  return { copied, total: laRucheSkills.length };
}

// ─── Sync épisodes mémoire → LaRuche ────────────────────────────────────────

async function syncMemory() {
  const episodesPath = join(DATA_DIR, 'episodes.jsonl');
  if (!existsSync(episodesPath)) return { synced: 0 };

  const lines = readFileSync(episodesPath, 'utf8').trim().split('\n').filter(Boolean);
  const recent = lines.slice(-20).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

  if (recent.length === 0) return { synced: 0 };

  try {
    const res = await fetch(`${LARUCHE_URL}/api/memory/store-batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ episodes: recent, source: 'ghost-os-ultimate' }),
      signal: AbortSignal.timeout(5000),
    });
    syncState.episodesSynced = recent.length;
    return { synced: recent.length, status: res.ok ? 'ok' : 'partial' };
  } catch {
    return { synced: 0, error: 'LaRuche memory API non disponible' };
  }
}

// ─── Vérifier si LaRuche est online ─────────────────────────────────────────

async function checkLaRuche() {
  try {
    const res = await fetch(`${LARUCHE_URL}/api/health`, { signal: AbortSignal.timeout(3000) });
    syncState.laruche_online = res.ok;
    return res.ok;
  } catch {
    syncState.laruche_online = false;
    return false;
  }
}

// ─── Reconstruire registry.json ─────────────────────────────────────────────

function rebuildRegistry() {
  const registry = {};
  try {
    const dirs = readdirSync(SKILLS_DIR);
    for (const d of dirs) {
      const skillPath = join(SKILLS_DIR, d);
      try {
        if (!statSync(skillPath).isDirectory()) continue;
        const mp = join(skillPath, 'manifest.json');
        const sp = join(skillPath, 'skill.js');
        if (existsSync(mp)) {
          registry[d] = JSON.parse(readFileSync(mp, 'utf8'));
        } else if (existsSync(sp)) {
          registry[d] = { name: d, description: 'skill sans manifest', version: '1.0.0' };
        }
      } catch {}
    }
    writeFileSync(join(SKILLS_DIR, 'registry.json'), JSON.stringify(registry, null, 2));
  } catch {}
  return registry;
}

// ─── Sync complète ───────────────────────────────────────────────────────────

async function runSync() {
  syncState.errors = [];
  const isOnline = await checkLaRuche();
  const skillsResult = await syncSkills();
  const memoryResult = isOnline ? await syncMemory() : { synced: 0 };

  syncState.lastSync = new Date().toISOString();
  console.log(`[LaRucheSync] Sync — LaRuche:${isOnline ? 'online' : 'offline'} | Skills:+${skillsResult.copied} | Épisodes:${memoryResult.synced}`);
  return { skills: skillsResult, memory: memoryResult, laruche_online: isOnline };
}

// ─── Boucle de sync toutes les 5min ──────────────────────────────────────────

setInterval(runSync, 5 * 60 * 1000);
runSync(); // sync initiale au démarrage

// ─── HTTP API :3007 ──────────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'GET' && url.pathname === '/health') {
    return res.end(JSON.stringify({ ok: true, service: 'laruche-sync', port: PORT }));
  }

  if (req.method === 'GET' && url.pathname === '/laruche-sync/status') {
    return res.end(JSON.stringify({
      ...syncState,
      laruche_url: LARUCHE_URL,
      ghost_url: GHOST_URL,
    }));
  }

  if (req.method === 'POST' && url.pathname === '/laruche-sync/trigger') {
    const result = await runSync();
    return res.end(JSON.stringify({ ok: true, ...result }));
  }

  res.statusCode = 404;
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => {
  console.log(`[LaRucheSync] Démarré sur :${PORT}`);
  console.log(`[LaRucheSync] LaRuche URL: ${LARUCHE_URL}`);
  console.log(`[LaRucheSync] Ghost URL:   ${GHOST_URL}`);
});
