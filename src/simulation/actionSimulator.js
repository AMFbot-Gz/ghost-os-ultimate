/**
 * src/simulation/actionSimulator.js — Simulateur d'actions (dry-run)
 *
 * Simule l'exécution d'une action ou d'un plan complet SANS les exécuter.
 * Pour chaque action, calcule :
 *   - Risque (level + score) via riskEstimator
 *   - Probabilité de succès estimée (inversement proportionnelle au risque)
 *   - Effets de bord attendus
 *   - Durée estimée en millisecondes
 *   - État prédit du bureau après l'action
 *   - Flag requiresConfirmation pour les actions dangereuses
 */

import { estimateRisk } from './riskEstimator.js';
import { predictStateAfter } from './desktopModel.js';

// ─── Table des durées estimées par skill (ms) ─────────────────────────────────

const DURATION_ESTIMATES = {
  take_screenshot: 300,
  open_app:        2000,
  goto_url:        3000,
  type_text:       500,
  smart_click:     800,
  run_command:     5000,
  run_shell:       5000,
  http_fetch:      2000,
  find_element:    1500,
};

// ─── API publique ──────────────────────────────────────────────────────────────

/**
 * Simule une action unique.
 *
 * La probabilité de succès est : max(0.1, 1.0 - riskScore * 0.5)
 * — score 0   → 100% de succès
 * — score 1   → 50% de succès (minimum 10%)
 *
 * @param {{ skill: string, params?: object }} action
 * @returns {object} Rapport de simulation
 */
export function simulate(action) {
  const { skill, params = {} } = action;
  const risk = estimateRisk(skill, params);
  const predictedState = predictStateAfter({ type: skill, params });

  const successProbability = Math.max(0.1, 1.0 - risk.score * 0.5);

  return {
    skill,
    params,
    successProbability:    Math.round(successProbability * 100) / 100,
    riskLevel:             risk.level,
    riskScore:             risk.score,
    sideEffects:           risk.sideEffects,
    estimatedDurationMs:   DURATION_ESTIMATES[skill] || 1000,
    requiresConfirmation:  risk.requiresConfirmation,
    predictedState,
  };
}

/**
 * Simule un plan complet (liste d'actions ordonnées).
 * Chaque étape est simulée indépendamment.
 *
 * @param {Array<{ skill: string, params?: object }>} steps
 * @returns {Array<object>} Tableau de rapports de simulation
 */
export function simulatePlan(steps) {
  return steps.map(step => simulate(step));
}
