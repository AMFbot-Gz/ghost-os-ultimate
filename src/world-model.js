/**
 * src/world-model.js — World Model Jarvis
 *
 * Maintient une connaissance permanente du contexte injecté dans CHAQUE
 * prompt envoyé à Ollama ou Claude. Rafraîchissement automatique toutes
 * les 5 minutes en background.
 *
 * Structure du modèle :
 *   user       — nom, timezone, projet en cours, dernière activité
 *   business   — commandes Shopify, emails urgents, prochains événements
 *   system     — PM2 processes, disque, dernière erreur, Ollama actifs
 *
 * Usage :
 *   import { getWorldContext, getSnapshot } from './world-model.js';
 *   const ctx = await getWorldContext(); // string injectée dans les prompts
 *   const snap = getSnapshot();          // objet complet
 */

import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const REFRESH_INTERVAL_MS = parseInt(process.env.WORLD_MODEL_REFRESH_MS || '300000'); // 5 min
const MEMORY_HUB_URL = `http://localhost:${process.env.MEMORY_HUB_PORT || '3004'}`;
const QUEEN_URL       = `http://localhost:${process.env.API_PORT || '3002'}`;

// ─── Modèle en RAM ────────────────────────────────────────────────────────────

let _model = {
  user: {
    name:           process.env.USER_NAME || 'Wiaam',
    timezone:       process.env.TZ || 'Europe/Paris',
    current_project: null,
    last_seen:       null,
  },
  business: {
    shopify_orders_today: null,
    urgent_emails:        null,
    next_event:           null,
    last_business_refresh: null,
  },
  system: {
    pm2_online:    null,
    pm2_errored:   [],
    disk_used_pct: null,
    disk_free_gb:  null,
    ollama_loaded: [],
    last_error:    null,
    last_refresh:  null,
  },
};

let _lastRefresh = 0;
let _refreshTimer = null;

// ─── Collecteurs ──────────────────────────────────────────────────────────────

function collectSystem() {
  try {
    // PM2
    const pm2Raw = execSync('pm2 jlist 2>/dev/null', { encoding: 'utf-8', timeout: 5000 });
    const pm2List = JSON.parse(pm2Raw);
    _model.system.pm2_online  = pm2List.filter(p => p.pm2_env?.status === 'online').length;
    _model.system.pm2_errored = pm2List
      .filter(p => p.pm2_env?.status !== 'online')
      .map(p => ({ name: p.name, status: p.pm2_env?.status }));
  } catch { _model.system.pm2_online = null; }

  try {
    // Disque
    const df = execSync("df -h / | tail -1 | awk '{print $5, $4}'", { encoding: 'utf-8', timeout: 3000 });
    const [used, free] = df.trim().split(' ');
    _model.system.disk_used_pct = used;
    _model.system.disk_free_gb  = free;
  } catch { /* non-fatal */ }

  try {
    // Modèles Ollama actifs en RAM
    const tags = execSync('curl -s http://localhost:11434/api/ps 2>/dev/null', { encoding: 'utf-8', timeout: 3000 });
    const data = JSON.parse(tags);
    _model.system.ollama_loaded = (data.models || []).map(m => m.name);
  } catch { _model.system.ollama_loaded = []; }

  _model.system.last_refresh = new Date().toISOString();
}

async function collectBusiness() {
  // Memory hub — derniers épisodes (proxy pour emails/events)
  try {
    const res = await fetch(`${MEMORY_HUB_URL}/memory/recent?limit=5`, {
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      const data = await res.json();
      const urgent = (data.entries || []).filter(e =>
        e.tags?.includes('email') && e.success
      ).length;
      _model.business.urgent_emails = urgent > 0 ? urgent : 0;
    }
  } catch { /* non-fatal */ }

  // World state de ghost-os (contient active_app, cpu_high, disk_low)
  try {
    const wsPath = resolve(ROOT, 'agent/memory/world_state.json');
    if (existsSync(wsPath)) {
      const ws = JSON.parse(readFileSync(wsPath, 'utf-8'));
      _model.user.current_project = ws.active_project || ws.last_mission_summary?.slice(0, 60) || null;
    }
  } catch { /* non-fatal */ }

  _model.business.last_business_refresh = new Date().toISOString();
}

// ─── Refresh ──────────────────────────────────────────────────────────────────

export async function refresh() {
  collectSystem();
  await collectBusiness();
  _lastRefresh = Date.now();
}

/**
 * Démarre le rafraîchissement automatique toutes les 5 min.
 * Appelé une fois au démarrage du gateway.
 */
export function startAutoRefresh() {
  if (_refreshTimer) return;
  // Premier refresh immédiat (non-bloquant)
  refresh().catch(() => {});
  _refreshTimer = setInterval(() => refresh().catch(() => {}), REFRESH_INTERVAL_MS);
  _refreshTimer.unref?.(); // ne bloque pas l'exit Node.js
  console.log(`[WorldModel] Auto-refresh toutes les ${REFRESH_INTERVAL_MS / 60000}min`);
}

/**
 * Retourne une snapshot complète du modèle.
 */
export function getSnapshot() {
  return JSON.parse(JSON.stringify(_model));
}

/**
 * Retourne une string de contexte compacte à injecter dans les prompts LLM.
 * Format optimisé pour la fenêtre de contexte Ollama.
 *
 * Exemple de sortie :
 *   "Utilisateur: Wiaam | Projet: LaRuche migration | PM2: 14/14 online |
 *    Disque: 72% utilisé (28Gi libre) | Ollama: llama3.2:3b en RAM"
 */
export async function getWorldContext() {
  // Rafraîchir si les données ont plus de 5 minutes
  if (Date.now() - _lastRefresh > REFRESH_INTERVAL_MS) {
    await refresh().catch(() => {});
  }

  const parts = [];

  // Utilisateur
  parts.push(`Utilisateur: ${_model.user.name}`);
  if (_model.user.current_project) {
    parts.push(`Projet actif: ${_model.user.current_project}`);
  }

  // Système
  if (_model.system.pm2_online !== null) {
    const errored = _model.system.pm2_errored.length;
    parts.push(`PM2: ${_model.system.pm2_online} online${errored > 0 ? `, ${errored} en erreur` : ''}`);
  }
  if (_model.system.disk_used_pct) {
    parts.push(`Disque: ${_model.system.disk_used_pct} utilisé (${_model.system.disk_free_gb} libre)`);
  }
  if (_model.system.ollama_loaded.length > 0) {
    parts.push(`Ollama actif: ${_model.system.ollama_loaded.join(', ')}`);
  }
  if (_model.system.last_error) {
    parts.push(`⚠️ Dernière erreur: ${_model.system.last_error.slice(0, 80)}`);
  }

  // Business
  if (_model.business.urgent_emails !== null && _model.business.urgent_emails > 0) {
    parts.push(`Emails urgents: ${_model.business.urgent_emails}`);
  }
  if (_model.business.shopify_orders_today !== null) {
    parts.push(`Commandes Shopify auj.: ${_model.business.shopify_orders_today}`);
  }

  return parts.join(' | ');
}

/**
 * Met à jour le champ user.last_seen (appelé à chaque message Telegram reçu).
 */
export function touchLastSeen() {
  _model.user.last_seen = new Date().toISOString();
}

/**
 * Enregistre la dernière erreur connue dans le modèle.
 * @param {string} error
 */
export function recordError(error) {
  _model.system.last_error = `${new Date().toISOString().slice(11, 19)} ${error.slice(0, 120)}`;
}
