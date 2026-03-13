/**
 * mission.js — Structures de données immuables pour les missions LaRuche v4.1
 * createMission, updateMissionState, addMissionStep, addModelUsed, finalizeMission
 *
 * v4.2 : statuts normalisés + transitions validées (Wave 1 — fiabilité missions)
 */
import { randomUUID } from 'crypto';

// ─── Statuts normalisés ────────────────────────────────────────────────────────
export const MissionStatus = {
  PENDING:   'pending',
  RUNNING:   'running',
  SUCCESS:   'success',
  PARTIAL:   'partial',    // certains steps ont échoué
  FAILED:    'failed',     // mission complètement échouée
  CANCELLED: 'cancelled',
  TIMEOUT:   'timeout',
};

// Transitions autorisées (machine d'état stricte)
export const VALID_TRANSITIONS = {
  pending:   ['running', 'cancelled'],
  running:   ['success', 'partial', 'failed', 'timeout', 'cancelled'],
  success:   [],  // terminal
  partial:   [],  // terminal
  failed:    [],  // terminal
  cancelled: [],  // terminal
  timeout:   [],  // terminal
};

/**
 * Indique si un statut est terminal (aucune transition possible).
 * @param {string} status
 * @returns {boolean}
 */
export function isTerminal(status) {
  return ['success', 'partial', 'failed', 'cancelled', 'timeout'].includes(status);
}

/**
 * Vérifie si la transition de `from` vers `to` est autorisée.
 * @param {string} from
 * @param {string} to
 * @returns {boolean}
 */
export function canTransition(from, to) {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Crée une nouvelle mission.
 * @param {object} opts
 * @param {string} opts.command
 * @param {string} [opts.source] - 'telegram' | 'standalone' | 'api' | 'cron'
 * @param {string} [opts.user_id]
 * @returns {object} Mission immuable
 */
export function createMission(opts = {}) {
  return Object.freeze({
    id: opts.id || randomUUID(),
    command: opts.command || '',
    source: opts.source || 'unknown',
    user_id: opts.user_id || null,
    status: 'pending',
    steps: [],
    models_used: [],
    created_at: new Date().toISOString(),
    completed_at: null,
    duration_ms: null,
    result: null,
    error: null,
    metadata: opts.metadata || {},
  });
}

/**
 * Met à jour l'état d'une mission (retourne un nouvel objet immuable).
 */
export function updateMissionState(mission, patch) {
  return Object.freeze({ ...mission, ...patch });
}

/**
 * Ajoute une étape à la mission.
 * @param {object} mission
 * @param {object} step - { id, skill, description, status, result?, error?, duration_ms? }
 */
export function addMissionStep(mission, step) {
  return Object.freeze({
    ...mission,
    steps: [...mission.steps, { ...step, ts: new Date().toISOString() }],
  });
}

/**
 * Enregistre un modèle utilisé (dédupliqué).
 */
export function addModelUsed(mission, model) {
  if (mission.models_used.includes(model)) return mission;
  return Object.freeze({ ...mission, models_used: [...mission.models_used, model] });
}

/**
 * Finalise la mission (calcule duration_ms, completed_at).
 * @param {object} mission
 * @param {object} [patch] - { status, result?, error? }
 */
export function finalizeMission(mission, patch = {}) {
  const completed_at = new Date().toISOString();
  const duration_ms = Date.now() - new Date(mission.created_at).getTime();
  return Object.freeze({ ...mission, ...patch, completed_at, duration_ms });
}

/**
 * Résumé lisible d'une mission.
 */
export function missionSummary(mission) {
  const dur = mission.duration_ms ? `${(mission.duration_ms / 1000).toFixed(1)}s` : 'en cours';
  const models = mission.models_used.length ? mission.models_used.join(', ') : 'aucun';
  return `[Mission ${mission.id.slice(0, 8)}] ${mission.status} — ${dur} — ${mission.steps.length} étapes — Modèles: ${models}`;
}
