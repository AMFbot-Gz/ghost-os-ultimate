/**
 * src/market/reputationSystem.js — Système de réputation des agents
 *
 * Score de réputation basé sur l'historique de succès et la latence :
 *   reputation = 0.75 * successRate + 0.25 * latencyScore
 *
 * La latence est normalisée sur 60s : un agent répondant en 0ms → score 1.0,
 * un agent répondant en ≥60s → score 0.0.
 */

/** @type {Map<string, { successCount: number, totalCount: number, avgLatencyMs: number, reputation: number }>} */
const _scores = new Map();

/**
 * Enregistre le résultat d'une tâche pour un agent.
 *
 * @param {string} agentId
 * @param {{ success: boolean, latencyMs?: number }} outcome
 */
export function recordOutcome(agentId, { success, latencyMs = 0 }) {
  let s = _scores.get(agentId) || {
    successCount: 0,
    totalCount: 0,
    avgLatencyMs: 500,
    reputation: 0.5,
  };

  s.totalCount++;
  if (success) s.successCount++;

  // EWMA latence (80% historique + 20% mesure actuelle)
  s.avgLatencyMs = Math.round(0.8 * s.avgLatencyMs + 0.2 * latencyMs);

  // Calcul du score de réputation
  const successRate = s.totalCount > 0 ? s.successCount / s.totalCount : 0.5;
  const latencyScore = Math.max(0, 1 - s.avgLatencyMs / 60000); // 0→1, normalisé sur 60s

  s.reputation = 0.75 * successRate + 0.25 * latencyScore;

  _scores.set(agentId, s);
}

/**
 * Retourne le score de réputation d'un agent.
 * Renvoie les valeurs par défaut si l'agent est inconnu.
 *
 * @param {string} agentId
 * @returns {{ reputation: number, successCount: number, totalCount: number, avgLatencyMs: number }}
 */
export function getReputation(agentId) {
  return _scores.get(agentId) || {
    reputation: 0.5,
    successCount: 0,
    totalCount: 0,
    avgLatencyMs: 500,
  };
}

/**
 * Retourne tous les scores de réputation (format objet clé→valeur).
 * @returns {Object}
 */
export function getAllScores() {
  return Object.fromEntries(_scores);
}

/**
 * Réinitialise tous les scores (utile pour les tests).
 */
export function _resetScores() {
  _scores.clear();
}
