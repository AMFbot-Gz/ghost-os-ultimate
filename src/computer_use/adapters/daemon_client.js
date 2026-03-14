/**
 * src/computer_use/adapters/daemon_client.js — DaemonClientAdapter
 *
 * Implémentation de ComputerUseAdapter qui appelle un Ghost Daemon distant
 * via HTTP JSON. Permet de contrôler n'importe quelle machine (Mac, Linux,
 * Windows) du moment qu'elle fait tourner le ghost_daemon.js.
 *
 * Format réseau :
 *   POST http://<daemonUrl>/act
 *     Body: { machine_id, action: { type, params } }
 *     Response: { success, data, error, duration_ms }
 *
 * Auth : header `X-Ghost-Secret: <DAEMON_SECRET>` (optionnel en LAN)
 */

import { ComputerUseAdapter } from '../adapter.js';
// (WAIT_TYPES/ACTION_TYPES importés depuis types.js si besoin)
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('DaemonClientAdapter');

// Timeout global par appel réseau (ms)
const NETWORK_TIMEOUT_MS = parseInt(process.env.DAEMON_TIMEOUT_MS || '20000', 10);

export class DaemonClientAdapter extends ComputerUseAdapter {
  /**
   * @param {string} machineId
   * @param {object} config
   * @param {string} config.daemonUrl   - base URL du daemon (ex: 'http://192.168.1.10:9000')
   * @param {string} [config.secret]    - token d'auth optionnel
   */
  constructor(machineId, config = {}) {
    super(machineId, config);
    if (!config.daemonUrl) throw new Error('DaemonClientAdapter: daemonUrl requis');
    this.daemonUrl = config.daemonUrl.replace(/\/$/, '');
    this.secret    = config.secret || process.env.DAEMON_SECRET || '';
  }

  _headers() {
    const h = { 'Content-Type': 'application/json' };
    if (this.secret) h['X-Ghost-Secret'] = this.secret;
    return h;
  }

  async _post(path, body) {
    const t0  = Date.now();
    const url = `${this.daemonUrl}${path}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), NETWORK_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method:  'POST',
        headers: this._headers(),
        body:    JSON.stringify({ machine_id: this.machineId, ...body }),
        signal:  ctrl.signal,
      });
      clearTimeout(timer);
      const json = await res.json();
      return { ...json, duration_ms: Date.now() - t0 };
    } catch (err) {
      clearTimeout(timer);
      const msg = err.name === 'AbortError'
        ? `Daemon ${this.machineId} timeout (>${NETWORK_TIMEOUT_MS}ms)`
        : `Daemon ${this.machineId} inaccessible: ${err.message}`;
      logger.error(msg);
      return { success: false, error: msg, duration_ms: Date.now() - t0 };
    }
  }

  async _get(path) {
    const t0  = Date.now();
    const url = `${this.daemonUrl}${path}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), NETWORK_TIMEOUT_MS);
    try {
      const res  = await fetch(url, { headers: this._headers(), signal: ctrl.signal });
      clearTimeout(timer);
      const json = await res.json();
      return { ...json, duration_ms: Date.now() - t0 };
    } catch (err) {
      clearTimeout(timer);
      return { success: false, error: err.message, duration_ms: Date.now() - t0 };
    }
  }

  // ── health ──────────────────────────────────────────────────────────────

  async health() {
    return this._timed(() => this._get('/health'));
  }

  // ── observe ─────────────────────────────────────────────────────────────

  async observe(options = {}) {
    return this._timed(() => this._post('/observe', { options }));
  }

  // ── act ─────────────────────────────────────────────────────────────────

  async act(action) {
    return this._timed(() => this._post('/act', { action }));
  }

  // ── screenshot ──────────────────────────────────────────────────────────

  async screenshot(options = {}) {
    return this._timed(() => this._post('/screenshot', { options }));
  }

  // ── waitFor ─────────────────────────────────────────────────────────────

  async waitFor(condition, timeoutMs = 10000) {
    return this._timed(() => this._post('/wait', { condition, timeout_ms: timeoutMs }));
  }
}
