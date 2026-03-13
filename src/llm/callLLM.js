/**
 * callLLM.js — Helper centralisé pour appels LLM avec retry intelligent
 *
 * v4.2 (Wave 1 — fiabilité missions) :
 * - Classification TRANSIENT vs FATAL : retry uniquement sur TRANSIENT
 * - Backoff exponentiel avec jitter : min(base * 2^attempt + random(0,1000), maxDelay)
 * - Timeout global sur l'ensemble des retries (pas juste par tentative)
 * - Logs structurés à chaque retry avec missionId si disponible
 */
import { ask } from '../model_router.js';
import { logger } from '../utils/logger.js';
import { LaRucheError, ErrorCode } from '../utils/errorHandler.js';

const MAX_RETRIES       = parseInt(process.env.LLM_MAX_RETRIES    || '2');
const BASE_DELAY_MS     = parseInt(process.env.LLM_BASE_DELAY_MS  || '1000');
const MAX_DELAY_MS      = parseInt(process.env.LLM_MAX_DELAY_MS   || '15000');
// Timeout par appel LLM — 120s par défaut pour les modèles cloud lents
const LLM_TIMEOUT_MS    = parseInt(process.env.LLM_TIMEOUT_MS     || '120000');
// Timeout global sur l'ensemble des retries (base + délais cumulés max ~5 min)
const LLM_GLOBAL_TIMEOUT_MS = parseInt(process.env.LLM_GLOBAL_TIMEOUT_MS || '300000');

// ─── Classification des erreurs ────────────────────────────────────────────────
// Erreurs réseau transitoires → retry autorisé
const TRANSIENT_ERRORS = ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'socket hang up', 'ENOTFOUND'];
// Codes HTTP transitoires → retry autorisé
const TRANSIENT_STATUS = [429, 502, 503, 504];
// Codes HTTP fatals → pas de retry (inutile de réessayer)
const FATAL_STATUS     = [400, 401, 403, 404, 422];

/**
 * Détermine si une erreur est transitoire (mérite un retry) ou fatale.
 * @param {Error} err
 * @returns {boolean} true si on peut réessayer
 */
function isTransientError(err) {
  // Erreur réseau explicite
  if (TRANSIENT_ERRORS.some(code => err.message?.includes(code) || err.code === code)) {
    return true;
  }
  // Statut HTTP extrait du message ou de la propriété status/statusCode
  const status = err.status || err.statusCode || parseInt(err.message?.match(/HTTP (\d{3})/)?.[1]);
  if (status) {
    if (FATAL_STATUS.includes(status))     return false;
    if (TRANSIENT_STATUS.includes(status)) return true;
  }
  // Timeouts et erreurs génériques → transitoires
  if (err.message?.toLowerCase().includes('timeout'))  return true;
  if (err.message?.toLowerCase().includes('overload'))  return true;
  if (err.name === 'AbortError')                        return true;
  // Par défaut : considère comme transitoire (comportement conservateur)
  return true;
}

/**
 * Calcule le délai de backoff exponentiel avec jitter aléatoire.
 * Formula : min(base * 2^attempt + random(0, 1000), maxDelay)
 * @param {number} attempt — numéro de l'attempt (1-indexed)
 * @returns {number} délai en ms
 */
function backoffDelay(attempt) {
  const exponential = BASE_DELAY_MS * Math.pow(2, attempt - 1);
  const jitter      = Math.random() * 1000;
  return Math.min(exponential + jitter, MAX_DELAY_MS);
}

/**
 * Appel LLM avec retry intelligent et logs structurés.
 *
 * @param {string} prompt
 * @param {object} [options]
 * @param {string} [options.role]        - strategist | worker | architect | synthesizer | vision
 * @param {number} [options.temperature]
 * @param {string} [options.mission_id]
 * @param {string} [options.step_id]
 * @param {number} [options.num_predict]
 * @returns {Promise<{text: string, model: string, usage?: object}>}
 * @throws {LaRucheError} LLM_TIMEOUT si tous les essais échouent ou timeout global atteint
 */
export async function callLLM(prompt, options = {}) {
  const { mission_id, step_id, role, temperature, num_predict } = options;
  const callId    = `llm_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const globalEnd = Date.now() + LLM_GLOBAL_TIMEOUT_MS;

  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    // Vérifie le timeout global avant chaque tentative
    const remaining = globalEnd - Date.now();
    if (remaining <= 0) {
      logger.error('llm_global_timeout', { call_id: callId, mission_id, step_id, role, attempt });
      throw new LaRucheError(
        ErrorCode.LLM_TIMEOUT,
        `LLM timeout global atteint (${LLM_GLOBAL_TIMEOUT_MS}ms) après ${attempt - 1} tentative(s)`,
        { mission_id, step_id, recoverable: false }
      );
    }

    const t0 = Date.now();
    // Respecte le timeout global restant pour cette tentative individuelle
    const attemptTimeout = Math.min(LLM_TIMEOUT_MS, remaining);

    try {
      const result = await ask(prompt, { role, temperature, timeout: attemptTimeout, num_predict });
      // ask() n'émet pas d'exception — vérification explicite du succès
      if (!result.success) {
        throw new Error(result.error || 'Ollama non disponible');
      }

      logger.info('llm_call_success', {
        call_id: callId,
        mission_id,
        step_id,
        role,
        model: result.model,
        attempt,
        duration_ms: Date.now() - t0,
        prompt_preview: prompt.slice(0, 80),
      });
      return result;

    } catch (err) {
      const duration_ms = Date.now() - t0;
      const transient   = isTransientError(err);

      // Erreur fatale → pas de retry, échec immédiat
      if (!transient) {
        logger.error('llm_call_fatal', {
          call_id: callId, mission_id, step_id, role, attempt, duration_ms,
          error: err.message, error_type: 'FATAL',
        });
        throw new LaRucheError(
          ErrorCode.LLM_TIMEOUT,
          `LLM erreur fatale (non-retriable): ${err.message}`,
          { mission_id, step_id, recoverable: false }
        );
      }

      // Dernière tentative épuisée → échec définitif
      if (attempt > MAX_RETRIES) {
        logger.error('llm_call_failed', {
          call_id: callId, mission_id, step_id, role, attempt, duration_ms,
          error: err.message, error_type: 'TRANSIENT_EXHAUSTED',
        });
        throw new LaRucheError(
          ErrorCode.LLM_TIMEOUT,
          `LLM non disponible après ${MAX_RETRIES + 1} tentatives: ${err.message}`,
          { mission_id, step_id, recoverable: false }
        );
      }

      // Calcul du délai avec backoff exponentiel + jitter
      const delay = backoffDelay(attempt);
      logger.warn('llm_call_retry', {
        call_id: callId, mission_id, step_id, role, attempt, duration_ms,
        retry_in_ms: Math.round(delay), error: err.message, error_type: 'TRANSIENT',
        attempts_remaining: MAX_RETRIES - attempt + 1,
      });
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}
