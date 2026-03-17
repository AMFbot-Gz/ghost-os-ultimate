/**
 * src/hub/skillHub.js — Hub central de skills pour Ghost OS Ultimate
 *
 * La Reine héberge ce hub. Les Ruches pushent leurs skills ici
 * et pullent les skills qu'elles n'ont pas encore.
 *
 * Routes (Hono):
 *   GET  /api/v1/hub/registry              — liste de tous les skills (delta via ?since=ISO)
 *   POST /api/v1/hub/skills/publish        — Ruche publie un nouveau skill
 *   GET  /api/v1/hub/skills/:name/code     — télécharge le code d'un skill
 *   GET  /api/v1/hub/skills/:name/manifest — télécharge le manifest d'un skill
 *   GET  /api/v1/hub/stats                 — statistiques globales du hub
 *
 * Storage: filesystem dans skills/hub/{machine_id}/{skill_name}/
 * Registry: skills/hub/registry.json (agrégé de toutes les ruches)
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { rename, readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT       = join(__dirname, '..', '..');
const HUB_DIR    = join(ROOT, 'skills', 'hub');
const HUB_REGISTRY = join(HUB_DIR, 'registry.json');

const _ruches = new Map(); // ruche_id → { machine_id, status, last_seen, ... }

// ─── Semaphore registry ──────────────────────────────────────────────────────
let   _registryLock = false;
const _registryQueue = [];

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Compare deux versions sémantiques (ex: "1.2.0" > "1.1.3") */
function _semverGt(a, b) {
  const pa = String(a || '0.0.0').split('.').map(Number);
  const pb = String(b || '0.0.0').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return true;
    if ((pa[i] || 0) < (pb[i] || 0)) return false;
  }
  return false; // égaux
}

function _readRegistry() {
  try {
    if (existsSync(HUB_REGISTRY))
      return JSON.parse(readFileSync(HUB_REGISTRY, 'utf-8'));
  } catch { /* ignore */ }
  return { version: '1.0.0', lastUpdated: new Date().toISOString(), skills: [] };
}

async function _atomicWrite(path, content) {
  const tmp = join(tmpdir(), `hub_${randomBytes(6).toString('hex')}.tmp`);
  await writeFile(tmp, content, 'utf-8');
  await rename(tmp, path);
}

/** Mise à jour atomique du registry via queue (évite les race conditions) */
async function _updateRegistry(skillInfo) {
  return new Promise((resolve) => {
    _registryQueue.push({ skillInfo, resolve });
    if (!_registryLock) _drainRegistryQueue();
  });
}

async function _drainRegistryQueue() {
  if (_registryQueue.length === 0) { _registryLock = false; return; }
  _registryLock = true;
  const { skillInfo, resolve } = _registryQueue.shift();

  const reg = _readRegistry();
  const idx = reg.skills.findIndex(s => s.name === skillInfo.name);

  if (idx >= 0) {
    const existing = reg.skills[idx];
    // Mise à jour si version plus récente OU même machine (override local)
    if (_semverGt(skillInfo.version, existing.version) || existing.machine_id === skillInfo.machine_id) {
      reg.skills[idx] = { ...existing, ...skillInfo, updatedAt: new Date().toISOString() };
    }
  } else {
    reg.skills.push({ ...skillInfo, publishedAt: new Date().toISOString(), downloads: 0 });
  }

  reg.lastUpdated = new Date().toISOString();
  await _atomicWrite(HUB_REGISTRY, JSON.stringify(reg, null, 2));
  resolve();
  _drainRegistryQueue();
}

// ─── Init ─────────────────────────────────────────────────────────────────────

export function initHub() {
  mkdirSync(HUB_DIR, { recursive: true });
  if (!existsSync(HUB_REGISTRY)) {
    writeFileSync(HUB_REGISTRY, JSON.stringify({
      version: '1.0.0',
      lastUpdated: new Date().toISOString(),
      skills: [],
    }, null, 2));
  }
  console.log(`[SkillHub] Initialisé — ${_readRegistry().skills.length} skills en base`);
}

// ─── Routes Hono ──────────────────────────────────────────────────────────────

export function registerHubRoutes(app) {
  initHub();

  // GET /api/v1/hub/registry — catalogue complet (delta via ?since=ISO)
  app.get('/api/v1/hub/registry', (c) => {
    const reg   = _readRegistry();
    const since = c.req.query('since') ? new Date(c.req.query('since')) : null;

    let skills = reg.skills;
    if (since && !isNaN(since.getTime())) {
      skills = skills.filter(s => {
        const ts = new Date(s.updatedAt || s.publishedAt || 0);
        return ts > since;
      });
    }

    return c.json({ ok: true, count: skills.length, skills, lastUpdated: reg.lastUpdated });
  });

  // POST /api/v1/hub/skills/publish — Ruche publie un skill
  app.post('/api/v1/hub/skills/publish', async (c) => {
    let body;
    try { body = await c.req.json(); } catch { return c.json({ ok: false, error: 'JSON invalide' }, 400); }

    const { name, version = '1.0.0', code, manifest, machine_id = 'unknown', ruche_id = 'unknown' } = body;

    if (!name || !code)                          return c.json({ ok: false, error: 'name + code requis' }, 400);
    if (!/^[a-zA-Z0-9_\-]+$/.test(name))        return c.json({ ok: false, error: 'Nom invalide' }, 400);
    if (typeof code !== 'string')                return c.json({ ok: false, error: 'code doit être une string' }, 400);
    if (code.length > 500_000)                   return c.json({ ok: false, error: 'Code trop grand (>500KB)' }, 400);

    // Stockage dans skills/hub/{machine_id}/{name}/
    const skillDir = join(HUB_DIR, machine_id, name);
    await mkdir(skillDir, { recursive: true });
    await _atomicWrite(join(skillDir, 'skill.js'), code);
    if (manifest && typeof manifest === 'object')
      await _atomicWrite(join(skillDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

    // Mise à jour du registry agrégé
    await _updateRegistry({
      name,
      version,
      machine_id,
      ruche_id,
      description: manifest?.description || '',
    });

    return c.json({ ok: true, name, version, machine_id });
  });

  // GET /api/v1/hub/skills/:name/code — télécharge le code (version la plus récente)
  app.get('/api/v1/hub/skills/:name/code', async (c) => {
    const name = c.req.param('name');
    if (!/^[a-zA-Z0-9_\-]+$/.test(name)) return c.json({ ok: false, error: 'Nom invalide' }, 400);

    const reg   = _readRegistry();
    const entry = reg.skills.find(s => s.name === name);
    if (!entry) return c.json({ ok: false, error: `Skill '${name}' introuvable` }, 404);

    const skillPath = join(HUB_DIR, entry.machine_id, name, 'skill.js');
    if (!existsSync(skillPath)) return c.json({ ok: false, error: 'Fichier source introuvable' }, 404);

    // Incrémenter le compteur de téléchargements (non-bloquant)
    const idx = reg.skills.findIndex(s => s.name === name);
    if (idx >= 0) {
      reg.skills[idx].downloads = (reg.skills[idx].downloads || 0) + 1;
      _atomicWrite(HUB_REGISTRY, JSON.stringify(reg, null, 2)).catch(() => {});
    }

    const code = await readFile(skillPath, 'utf-8');
    return c.json({ ok: true, name, version: entry.version, code, machine_id: entry.machine_id });
  });

  // GET /api/v1/hub/skills/:name/manifest — télécharge le manifest
  app.get('/api/v1/hub/skills/:name/manifest', async (c) => {
    const name = c.req.param('name');
    if (!/^[a-zA-Z0-9_\-]+$/.test(name)) return c.json({ ok: false, error: 'Nom invalide' }, 400);

    const reg   = _readRegistry();
    const entry = reg.skills.find(s => s.name === name);
    if (!entry) return c.json({ ok: false, error: `Skill '${name}' introuvable` }, 404);

    const manifestPath = join(HUB_DIR, entry.machine_id, name, 'manifest.json');
    if (!existsSync(manifestPath))
      return c.json({ ok: true, name, manifest: { name, version: entry.version } });

    const manifest = JSON.parse(await readFile(manifestPath, 'utf-8'));
    return c.json({ ok: true, name, manifest });
  });

  // GET /api/v1/hub/stats — statistiques du hub
  app.get('/api/v1/hub/stats', (c) => {
    const reg     = _readRegistry();
    const machines = [...new Set(reg.skills.map(s => s.machine_id))];
    const totalDl  = reg.skills.reduce((sum, s) => sum + (s.downloads || 0), 0);

    return c.json({
      ok:              true,
      total_skills:    reg.skills.length,
      machines_count:  machines.length,
      machines:        machines,
      total_downloads: totalDl,
      lastUpdated:     reg.lastUpdated,
      ruches_count:    _ruches.size,
    });
  });

  // POST /api/v1/ruches/heartbeat — Ruche annonce qu'elle est UP
  app.post('/api/v1/ruches/heartbeat', async (c) => {
    let body;
    try { body = await c.req.json(); } catch { return c.json({ ok: false, error: 'JSON invalide' }, 400); }

    const { ruche_id = 'unknown', machine_id = 'unknown', status = 'up', timestamp } = body;
    _ruches.set(ruche_id, {
      machine_id,
      status,
      last_seen: timestamp || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    return c.json({ ok: true, ruche_id, ack: new Date().toISOString() });
  });

  // GET /api/v1/ruches — liste toutes les ruches connues + état (up/stale/down)
  app.get('/api/v1/ruches', (c) => {
    const now = Date.now();
    const ruches = [];
    for (const [ruche_id, info] of _ruches.entries()) {
      const lastSeenMs = new Date(info.last_seen).getTime();
      const ageS = Math.round((now - lastSeenMs) / 1000);
      // Stale si pas de heartbeat depuis >120s, Down si >300s
      const health = ageS < 120 ? 'up' : ageS < 300 ? 'stale' : 'down';
      ruches.push({ ruche_id, ...info, age_s: ageS, health });
    }
    return c.json({ ok: true, count: ruches.length, ruches });
  });

  // POST /api/v1/hub/invalidate-cache — skill_sync.py notifie que de nouveaux skills sont dispo
  app.post('/api/v1/hub/invalidate-cache', (c) => {
    // Importe reloadSkills de skillLoader pour invalider le cache 5min
    import('../skills/skillLoader.js')
      .then(({ reloadSkills }) => reloadSkills())
      .catch(() => {});
    return c.json({ ok: true, message: 'Cache skills invalidé' });
  });

  console.log('[SkillHub] Routes montées: GET/POST /api/v1/hub/*');
}
