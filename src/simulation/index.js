/**
 * src/simulation/index.js — Point d'entrée du module Simulation Engine
 *
 * Exporte les trois sous-systèmes :
 *   - actionSimulator : Simulation d'actions et plans (dry-run)
 *   - riskEstimator   : Estimation de risque par skill
 *   - desktopModel    : Modèle de l'état du bureau + prédiction
 */

export { simulate, simulatePlan } from './actionSimulator.js';
export { estimateRisk, RiskLevel } from './riskEstimator.js';
export { updateDesktopState, getDesktopState } from './desktopModel.js';
