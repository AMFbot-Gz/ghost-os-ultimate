/**
 * laruche-bridge.js — Bridge de migration ghost-os → LaRuche
 *
 * Phase actuelle : Phase 1
 *   ghost-os reste maître sur :3002
 *   LaRuche disponible en parallèle sur :3000
 *   Les missions sont routées vers LaRuche si disponible, ghost-os sinon
 *
 * Roadmap :
 *   Phase 2 — LaRuche devient maître, ghost-os en fallback
 *   Phase 3 — ghost-os arrêté, LaRuche seul
 */

import fetch from 'node-fetch';
import { logger } from './utils/logger.js';

const GHOST_URL   = process.env.GHOST_OS_URL   || 'http://localhost:3002';
const LARUCHE_URL = process.env.LARUCHE_URL    || 'http://localhost:3000';
const PHASE       = parseInt(process.env.MIGRATION_PHASE || '1');

let _laRucheAvailable = null;
let _lastCheck = 0;
const CHECK_TTL_MS = 10_000; // re-check toutes les 10s

/**
 * Vérifie si LaRuche est disponible (avec cache 10s).
 */
async function isLaRucheUp() {
  if (PHASE === 1 && Date.now() - _lastCheck < CHECK_TTL_MS) {
    return _laRucheAvailable;
  }
  try {
    const r = await fetch(`${LARUCHE_URL}/api/health`, {
      signal: AbortSignal.timeout(2000),
    });
    _laRucheAvailable = r.ok;
  } catch {
    _laRucheAvailable = false;
  }
  _lastCheck = Date.now();
  return _laRucheAvailable;
}

/**
 * Route une mission vers LaRuche (Phase 1 : fallback ghost-os).
 * Phase 2+ : LaRuche est maître, ghost-os en fallback.
 *
 * @param {string} command
 * @param {object} [opts]
 * @param {string} [opts.skill]
 * @param {number} [opts.timeout_ms=60000]
 * @returns {Promise<object>}
 */
export async function routeMission(command, opts = {}) {
  const { skill = null, timeout_ms = 60_000 } = opts;
  const payload = JSON.stringify({ command, skill });

  // Phase 1 : tente LaRuche, fallback ghost-os
  if (PHASE === 1) {
    const laRucheUp = await isLaRucheUp();
    if (laRucheUp) {
      try {
        const res = await fetch(`${LARUCHE_URL}/api/mission`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          signal: AbortSignal.timeout(timeout_ms),
        });
        const data = await res.json();
        logger.info('bridge_mission_laruche', { command: command.slice(0, 60), skill });
        return { ...data, _source: 'laruche' };
      } catch (e) {
        logger.warn('bridge_laruche_fallback', { reason: e.message });
        _laRucheAvailable = false;
      }
    }
  }

  // Phase 2 : LaRuche est maître, ghost-os en fallback
  if (PHASE === 2) {
    const laRucheUp = await isLaRucheUp();
    if (!laRucheUp) {
      logger.warn('bridge_ghost_fallback_p2', { command: command.slice(0, 60) });
    } else {
      const res = await fetch(`${LARUCHE_URL}/api/mission`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        signal: AbortSignal.timeout(timeout_ms),
      });
      const data = await res.json();
      return { ...data, _source: 'laruche' };
    }
  }

  // Fallback (ou Phase 3 impossible — ghost-os arrêté)
  if (PHASE >= 3) {
    throw new Error('MIGRATION_PHASE=3 : ghost-os arrêté, LaRuche indisponible');
  }

  const res = await fetch(`${GHOST_URL}/api/mission`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
    signal: AbortSignal.timeout(timeout_ms),
  });
  const data = await res.json();
  logger.info('bridge_mission_ghost', { command: command.slice(0, 60), skill });
  return { ...data, _source: 'ghost-os' };
}

/**
 * Statut du bridge — utile pour /api/health ou monitoring.
 */
export async function bridgeStatus() {
  const laRucheUp = await isLaRucheUp();
  return {
    phase: PHASE,
    ghost_os_url: GHOST_URL,
    laruche_url: LARUCHE_URL,
    laruche_available: laRucheUp,
    active_backend: PHASE >= 2 && laRucheUp ? 'laruche' : 'ghost-os',
  };
}
