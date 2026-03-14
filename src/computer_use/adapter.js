/**
 * src/computer_use/adapter.js — Interface abstraite ComputerUseAdapter
 *
 * Sépare le cœur agentique (Ghost Core) des APIs native de chaque OS.
 * Le cœur ne connaît que cette interface — jamais d'appels directs à macOS/Windows/Linux.
 *
 * Architecture :
 *   Ghost Core
 *     └── ComputerUseAdapter (this file — abstract contract)
 *           ├── MacOsDirectAdapter  — wraps skills existants (même machine, zéro disruption)
 *           └── DaemonClientAdapter — client HTTP vers un Ghost Daemon distant (multi-machine)
 *
 * Usage :
 *   import { getAdapter } from './adapter.js';
 *   const adapter = getAdapter('mac-local');
 *   const { data } = await adapter.observe({ app: 'Safari' });
 *   await adapter.act({ type: 'smart_click', query: 'bouton Envoyer' });
 */

// Les adapters sont importés dynamiquement dans getAdapter() pour éviter les
// dépendances circulaires (macos_direct → adapter → macos_direct).
import { getMachineProfile, updateMachineProfile } from './machine_registry.js';
import { createLogger } from '../utils/logger.js';
export { ACTION_TYPES, WAIT_TYPES } from './types.js';

const logger = createLogger('ComputerUseAdapter');

// ─── Registre des adapters instanciés ──────────────────────────────────────
const _adapters = new Map();

// ─── Interface abstraite ────────────────────────────────────────────────────

/**
 * Classe de base — définit le contrat de toutes les implémentations.
 *
 * Toutes les méthodes retournent :
 *   { success: boolean, data?: any, error?: string, duration_ms?: number }
 */
export class ComputerUseAdapter {
  /**
   * @param {string} machineId  - identifiant unique de la machine (ex: "mac-local", "bureau-m2")
   * @param {object} config     - config spécifique à l'implémentation
   */
  constructor(machineId, config = {}) {
    if (!machineId) throw new Error('machineId requis');
    this.machineId = machineId;
    this.config    = config;
  }

  /** Vérifie que la machine est joignable et opérationnelle. */
  async health() {
    throw new Error(`${this.constructor.name}.health() non implémenté`);
  }

  /**
   * Observe l'état de l'écran : arbre d'accessibilité + métadonnées.
   * @param {ObserveOptions} options
   * @returns {Promise<AdapterResult<ObserveData>>}
   */
  async observe(options = {}) {
    throw new Error(`${this.constructor.name}.observe() non implémenté`);
  }

  /**
   * Exécute une action sur la machine.
   * @param {Action} action
   * @returns {Promise<AdapterResult<ActionData>>}
   */
  async act(action) {
    throw new Error(`${this.constructor.name}.act() non implémenté`);
  }

  /**
   * Prend une capture d'écran.
   * @param {ScreenshotOptions} options
   * @returns {Promise<AdapterResult<ScreenshotData>>}
   */
  async screenshot(options = {}) {
    throw new Error(`${this.constructor.name}.screenshot() non implémenté`);
  }

  /**
   * Attend qu'une condition soit vraie (ex: élément visible).
   * @param {WaitCondition} condition
   * @param {number} timeoutMs
   * @returns {Promise<AdapterResult<WaitData>>}
   */
  async waitFor(condition, timeoutMs = 10000) {
    throw new Error(`${this.constructor.name}.waitFor() non implémenté`);
  }

  // ─── Helpers partagés ──────────────────────────────────────────────────

  /** Wrapper chronométré pour toutes les méthodes. */
  async _timed(fn) {
    const t0 = Date.now();
    try {
      const result = await fn();
      const duration_ms = Date.now() - t0;
      // Enregistre la latence dans le profil machine (synchrone, fire-and-forget)
      try { updateMachineProfile(this.machineId, { last_seen: new Date().toISOString() }); } catch { /* ignore */ }
      return { ...result, duration_ms };
    } catch (err) {
      const duration_ms = Date.now() - t0;
      logger.error(`[${this.machineId}] Erreur adapter: ${err.message}`);
      return { success: false, error: err.message, duration_ms };
    }
  }
}

// ─── Types JSDoc ────────────────────────────────────────────────────────────

/**
 * @typedef {object} AdapterResult
 * @property {boolean} success
 * @property {any}     [data]
 * @property {string}  [error]
 * @property {number}  [duration_ms]
 */

/**
 * @typedef {object} ObserveOptions
 * @property {string}   [app]       - filtre sur une app spécifique
 * @property {string[]} [roles]     - filtrer par rôles AX (button, textField, ...)
 * @property {boolean}  [vision]    - inclure analyse vision LLM en fallback
 */

/**
 * @typedef {object} ObserveData
 * @property {string}    app
 * @property {Element[]} elements
 * @property {number}    elements_count
 * @property {object}    [resolution]
 */

/**
 * @typedef {object} Element
 * @property {string} role
 * @property {string} title
 * @property {number} x
 * @property {number} y
 * @property {number} width
 * @property {number} height
 * @property {number} confidence
 */

/**
 * @typedef {object} Action
 * @property {string} type    - 'click'|'type_text'|'press_key'|'open_app'|'goto_url'|'smart_click'|'scroll'|'drag'
 * @property {object} params  - paramètres spécifiques au type d'action
 */

// ACTION_TYPES et WAIT_TYPES sont définis dans types.js et ré-exportés ci-dessus.
// (import depuis types.js pour éviter les dépendances circulaires avec les adapters)

// ─── Factory ────────────────────────────────────────────────────────────────

/**
 * Retourne l'adapter pour une machine donnée.
 * Crée et met en cache les instances.
 *
 * Logique de sélection :
 *   1. Si machineId == machine locale (MACHINE_ID env) → MacOsDirectAdapter
 *   2. Sinon → DaemonClientAdapter (appel HTTP vers daemon distant)
 *
 * @param {string} machineId
 * @param {object} [options]
 * @param {string} [options.daemonUrl]  - override URL daemon (ex: 'http://192.168.1.10:9000')
 * @returns {ComputerUseAdapter}
 */
/**
 * Retourne l'adapter pour une machine donnée (async — dynamic import).
 * @param {string} machineId
 * @param {object} [options]
 * @returns {Promise<ComputerUseAdapter>}
 */
export async function getAdapter(machineId, options = {}) {
  if (_adapters.has(machineId)) return _adapters.get(machineId);

  const localId = process.env.MACHINE_ID || 'mac-local';
  let adapter;

  if (machineId === localId || machineId === 'local') {
    const { MacOsDirectAdapter } = await import('./adapters/macos_direct.js');
    adapter = new MacOsDirectAdapter(machineId);
    logger.info(`[${machineId}] Adapter: MacOsDirect (local)`);
  } else {
    const { DaemonClientAdapter } = await import('./adapters/daemon_client.js');
    const profile = getMachineProfile(machineId);
    const daemonUrl = options.daemonUrl
      || profile?.daemon_url
      || `http://localhost:${process.env.DAEMON_PORT || 9000}`;
    adapter = new DaemonClientAdapter(machineId, { daemonUrl });
    logger.info(`[${machineId}] Adapter: DaemonClient → ${daemonUrl}`);
  }

  _adapters.set(machineId, adapter);
  return adapter;
}

/**
 * Invalide l'adapter mis en cache pour une machine.
 * À appeler si la config daemon change.
 */
export function resetAdapter(machineId) {
  _adapters.delete(machineId);
}

/**
 * Liste toutes les machines connues (profils + adapters en cache).
 * @returns {string[]} machineIds
 */
export function listKnownMachines() {
  return Array.from(_adapters.keys());
}
