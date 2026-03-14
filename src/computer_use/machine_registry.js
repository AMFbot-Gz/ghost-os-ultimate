/**
 * src/computer_use/machine_registry.js — Registre et profils des machines
 *
 * Stocke un profil JSON par machine dans data/machine_profiles/<machineId>.json
 *
 * Profil machine :
 * {
 *   machine_id:    string,         // identifiant unique
 *   label:         string,         // nom lisible ("Mac Bureau M2")
 *   platform:      string,         // 'darwin'|'linux'|'win32'
 *   daemon_url:    string,         // URL daemon ("http://192.168.1.10:9000")
 *   daemon_port:   number,
 *   resolution:    { width, height },
 *   theme:         string,         // 'dark'|'light'
 *   frequent_apps: string[],
 *   perf: {
 *     click_success_rate: number,
 *     avg_action_ms:      number,
 *     total_actions:      number,
 *     total_errors:       number,
 *   },
 *   patterns:      { [intent]: step[] },   // séquences apprises
 *   last_seen:     string,
 *   registered_at: string,
 * }
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, renameSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createLogger } from '../utils/logger.js';

const __dirname    = dirname(fileURLToPath(import.meta.url));
const ROOT         = join(__dirname, '../../');
const PROFILES_DIR = join(ROOT, 'data', 'machine_profiles');
const logger       = createLogger('MachineRegistry');

// Cache en mémoire
const _cache = new Map();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function ensureDir() {
  if (!existsSync(PROFILES_DIR)) mkdirSync(PROFILES_DIR, { recursive: true });
}

function sanitize(id) {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
}

function profilePath(machineId) {
  return join(PROFILES_DIR, `${sanitize(machineId)}.json`);
}

function deepMerge(target, source) {
  const result = { ...target };
  for (const [k, v] of Object.entries(source)) {
    if (v !== null && typeof v === 'object' && !Array.isArray(v) && typeof result[k] === 'object') {
      result[k] = deepMerge(result[k], v);
    } else {
      result[k] = v;
    }
  }
  return result;
}

function flushProfile(machineId, profile) {
  ensureDir();
  const file = profilePath(machineId);
  const tmp  = `${file}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(profile, null, 2), 'utf8');
    renameSync(tmp, file); // atomic write
  } catch {
    try { writeFileSync(file, JSON.stringify(profile, null, 2), 'utf8'); }
    catch (err) { logger.error(`Sauvegarde profil ${machineId}: ${err.message}`); }
  }
}

// ─── Profil par défaut ────────────────────────────────────────────────────────

function defaultProfile(machineId) {
  return {
    machine_id:    machineId,
    label:         machineId,
    platform:      process.platform,
    daemon_url:    `http://localhost:${process.env.DAEMON_PORT || 9000}`,
    daemon_port:   parseInt(process.env.DAEMON_PORT || '9000', 10),
    resolution:    { width: 2560, height: 1600 },
    theme:         'dark',
    frequent_apps: [],
    perf: {
      click_success_rate: 1.0,
      avg_action_ms:      0,
      total_actions:      0,
      total_errors:       0,
    },
    patterns:      {},
    last_seen:     null,
    registered_at: new Date().toISOString(),
  };
}

// ─── Lecture ──────────────────────────────────────────────────────────────────

/**
 * Retourne le profil d'une machine (crée le profil par défaut si inexistant).
 * @param {string} machineId
 * @returns {object}
 */
export function getMachineProfile(machineId) {
  if (_cache.has(machineId)) return _cache.get(machineId);

  ensureDir();
  const file = profilePath(machineId);
  let profile;

  if (existsSync(file)) {
    try {
      profile = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      logger.warn(`Profil corrompu pour ${machineId} — réinitialisation`);
      profile = defaultProfile(machineId);
    }
  } else {
    profile = defaultProfile(machineId);
    flushProfile(machineId, profile);
    logger.info(`Nouveau profil machine créé: ${machineId}`);
  }

  _cache.set(machineId, profile);
  return profile;
}

/**
 * Liste tous les profils enregistrés.
 * @returns {object[]}
 */
export function listMachineProfiles() {
  ensureDir();
  try {
    return readdirSync(PROFILES_DIR)
      .filter(f => f.endsWith('.json') && !f.endsWith('.tmp'))
      .map(f => {
        try { return JSON.parse(readFileSync(join(PROFILES_DIR, f), 'utf8')); }
        catch { return null; }
      })
      .filter(Boolean);
  } catch { return []; }
}

// ─── Écriture ──────────────────────────────────────────────────────────────────

/**
 * Merge partiel du profil (ne remplace pas, fusionne récursivement).
 * @param {string} machineId
 * @param {object} updates
 * @returns {object} profil mis à jour
 */
export function updateMachineProfile(machineId, updates) {
  const current = getMachineProfile(machineId);
  const updated = deepMerge(current, updates);
  _cache.set(machineId, updated);
  flushProfile(machineId, updated);
  return updated;
}

/**
 * Enregistre le résultat d'une action dans les métriques de perf.
 * @param {string} machineId
 * @param {{ success: boolean, duration_ms: number }} result
 */
export function recordActionResult(machineId, result) {
  const profile = getMachineProfile(machineId);
  const perf    = { ...profile.perf };

  perf.total_actions++;
  if (!result.success) perf.total_errors++;
  if (result.duration_ms != null) {
    const n = perf.total_actions;
    perf.avg_action_ms = Math.round(
      (perf.avg_action_ms * (n - 1) + result.duration_ms) / n
    );
  }
  perf.click_success_rate = perf.total_actions > 0
    ? parseFloat(((perf.total_actions - perf.total_errors) / perf.total_actions).toFixed(3))
    : 1.0;

  updateMachineProfile(machineId, { perf, last_seen: new Date().toISOString() });
}

/**
 * Enregistre un pattern (séquence de steps réussie) pour cette machine.
 * @param {string} machineId
 * @param {string} intent
 * @param {object[]} steps
 */
export function learnPattern(machineId, intent, steps) {
  const profile  = getMachineProfile(machineId);
  const patterns = { ...profile.patterns, [intent]: steps };
  updateMachineProfile(machineId, { patterns });
  logger.info(`[${machineId}] Pattern appris: "${intent.slice(0, 60)}" (${steps.length} steps)`);
}

/**
 * Cherche un pattern appris pour cette machine (exact puis fuzzy).
 * @param {string} machineId
 * @param {string} intent
 * @returns {object[]|null}
 */
export function recallPattern(machineId, intent) {
  const profile = getMachineProfile(machineId);
  if (!profile.patterns || !Object.keys(profile.patterns).length) return null;

  // 1. Exact
  if (profile.patterns[intent]) return profile.patterns[intent];

  // 2. Fuzzy : chaque mot de l'intent doit être dans la clé ou vice-versa
  const normIntent = intent.toLowerCase();
  const words      = normIntent.split(/\s+/).filter(w => w.length > 3);
  let bestKey  = null;
  let bestScore = 0;
  for (const key of Object.keys(profile.patterns)) {
    const normKey  = key.toLowerCase();
    const matches  = words.filter(w => normKey.includes(w)).length;
    const score    = words.length > 0 ? matches / words.length : 0;
    if (score > bestScore && score >= 0.6) { bestScore = score; bestKey = key; }
  }
  return bestKey ? profile.patterns[bestKey] : null;
}
