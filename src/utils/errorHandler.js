/**
 * errorHandler.js — Gestion d'erreurs centralisée LaRuche v4.1
 * Codes d'erreur typés + LaRucheError + handleError normalisé
 */
import { logger } from './logger.js';

// ─── Codes d'erreur ────────────────────────────────────────────────────────────
export const ErrorCode = {
  LLM_TIMEOUT:      'LLM_TIMEOUT',
  LLM_PARSE_ERROR:  'LLM_PARSE_ERROR',
  LLM_RATE_LIMIT:   'LLM_RATE_LIMIT',
  MCP_TIMEOUT:      'MCP_TIMEOUT',
  MCP_ERROR:        'MCP_ERROR',
  SKILL_NOT_FOUND:  'SKILL_NOT_FOUND',
  SKILL_EXEC_ERROR: 'SKILL_EXEC_ERROR',
  HITL_REJECTED:    'HITL_REJECTED',
  HITL_TIMEOUT:     'HITL_TIMEOUT',
  MISSION_FAILED:   'MISSION_FAILED',
  CONFIG_MISSING:   'CONFIG_MISSING',
  VISION_FAILED:    'VISION_FAILED',
  ROLLBACK_ERROR:   'ROLLBACK_ERROR',
  UNKNOWN:          'UNKNOWN',
};

// ─── LaRucheError ─────────────────────────────────────────────────────────────
export class LaRucheError extends Error {
  /**
   * @param {string} code - ErrorCode constant
   * @param {string} message
   * @param {object} [context]
   * @param {string} [context.mission_id]
   * @param {string} [context.step_id]
   * @param {string} [context.tool]
   * @param {boolean} [context.recoverable]
   */
  constructor(code, message, context = {}) {
    super(message);
    this.name = 'LaRucheError';
    this.code = code;
    this.mission_id = context.mission_id || null;
    this.step_id = context.step_id || null;
    this.tool = context.tool || null;
    this.recoverable = context.recoverable ?? false;
    this.ts = new Date().toISOString();
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      mission_id: this.mission_id,
      step_id: this.step_id,
      tool: this.tool,
      recoverable: this.recoverable,
      ts: this.ts,
    };
  }
}

// ─── handleError ──────────────────────────────────────────────────────────────
/**
 * Normalise et log une erreur sans la relancer.
 * @param {Error|LaRucheError} err
 * @param {object} [context]
 * @returns {LaRucheError}
 */
export function handleError(err, context = {}) {
  let laErr;
  if (err instanceof LaRucheError) {
    laErr = err;
  } else {
    laErr = new LaRucheError(err.code || ErrorCode.UNKNOWN, err.message, {
      ...context,
      recoverable: false,
    });
    laErr.stack = err.stack;
  }

  logger.error(laErr.message, { ...laErr.toJSON(), ...context });
  return laErr;
}
