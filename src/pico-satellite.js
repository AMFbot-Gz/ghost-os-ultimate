/**
 * src/pico-satellite.js — Bridge Jarvis ↔ PicoClaw satellite
 *
 * PicoClaw est un agent Go léger (github.com/sipeed/picoclaw) qui s'exécute
 * en parallèle de la Queen Node.js. Il gère les tâches légères (surveillance,
 * health checks, web search) sans charger Ollama principal.
 *
 * Architecture :
 *   PicoClaw binary `gateway` → HTTP :8090 → POST /agent/run
 *   Jarvis orchestrateur → satellite.dispatch(command) → résultat
 *
 * Config PicoClaw : ~/.picoclaw/config.json (géré par picoclaw onboard)
 * Le canal Telegram y est DÉSACTIVÉ — seul jarvis-gateway.js parle Telegram.
 *
 * Si le binaire est absent : log warning + isAvailable() = false.
 * Le reste de Jarvis continue sans le satellite.
 */

import { existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn, execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const PICOCLAW_PORT = parseInt(process.env.PICOCLAW_PORT || '8090');
const PICOCLAW_HOST = `http://localhost:${PICOCLAW_PORT}`;
const PICOCLAW_TIMEOUT = 30_000;

// Chemins de recherche du binaire (x86_64 en premier, arm64 fallback)
const BINARY_PATHS = [
  join(ROOT, 'satellite', 'picoclaw'),
  join(process.env.HOME || '/tmp', '.picoclaw', 'bin', 'picoclaw'),
  '/usr/local/bin/picoclaw',
];

let _process = null;
let _available = null; // null = non testé, true/false = résultat

// ─── Découverte du binaire ────────────────────────────────────────────────────

function findBinary() {
  for (const p of BINARY_PATHS) {
    if (existsSync(p)) return p;
  }
  // Chercher dans PATH
  try {
    const found = execSync('which picoclaw 2>/dev/null', { encoding: 'utf-8', timeout: 2000 }).trim();
    if (found) return found;
  } catch { /* continue */ }
  return null;
}

// ─── Démarrage ────────────────────────────────────────────────────────────────

/**
 * Initialise le satellite PicoClaw.
 * Commande : picoclaw gateway (lit ~/.picoclaw/config.json)
 * Si déjà en cours d'exécution sur :8090 → ne fait rien.
 * Si binaire disponible → démarre en background.
 * Si absent → log warning, retourne false.
 *
 * @returns {Promise<boolean>} true si le satellite est opérationnel
 */
export async function init() {
  // Déjà actif ?
  if (await isAvailable()) return true;

  const binary = findBinary();
  if (!binary) {
    console.warn('[PicoClaw] Binaire introuvable — satellite désactivé');
    console.warn('[PicoClaw] Pour installer: bash install.sh (section PicoClaw auto-téléchargée)');
    _available = false;
    return false;
  }

  // Démarrer le binaire en mode gateway
  try {
    _process = spawn(binary, ['gateway', '--allow-empty'], {
      detached: false,
      stdio:    ['ignore', 'ignore', 'ignore'],
    });
    _process.unref();

    // Attendre que le gateway soit prêt (max 10s)
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 500));
      if (await isAvailable()) {
        console.log(`[PicoClaw] ✅ Satellite démarré sur :${PICOCLAW_PORT} (pid ${_process.pid})`);
        return true;
      }
    }
    console.warn('[PicoClaw] Binaire démarré mais gateway non joignable après 10s');
  } catch (e) {
    console.warn('[PicoClaw] Échec démarrage:', e.message);
  }

  _available = false;
  return false;
}

// ─── Disponibilité ────────────────────────────────────────────────────────────

/**
 * Teste si le gateway PicoClaw est joignable.
 * @returns {Promise<boolean>}
 */
export async function isAvailable() {
  try {
    const res = await fetch(`${PICOCLAW_HOST}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    _available = res.ok;
    return _available;
  } catch {
    _available = false;
    return false;
  }
}

// ─── Dispatch ─────────────────────────────────────────────────────────────────

/**
 * Délègue une commande au satellite PicoClaw.
 * Retourne { success, result, source: 'picoclaw' } ou lance une erreur.
 *
 * @param {string} command — message en langage naturel
 * @param {number} [timeoutMs=30000]
 * @returns {Promise<{success: boolean, result: string, source: 'picoclaw'}>}
 */
export async function dispatch(command, timeoutMs = PICOCLAW_TIMEOUT) {
  if (!await isAvailable()) {
    throw new Error('PicoClaw satellite non disponible');
  }

  const res = await fetch(`${PICOCLAW_HOST}/agent/run`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ message: command }),
    signal:  AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) throw new Error(`PicoClaw HTTP ${res.status}`);
  const data = await res.json();

  return {
    success: true,
    result:  data.response || data.result || JSON.stringify(data).slice(0, 400),
    source:  'picoclaw',
    model:   'ollama/llama3.2:3b',
  };
}

/**
 * Arrête le processus PicoClaw si lancé par ce module.
 */
export function stop() {
  if (_process) {
    _process.kill('SIGTERM');
    _process = null;
    _available = false;
    console.log('[PicoClaw] Satellite arrêté');
  }
}
