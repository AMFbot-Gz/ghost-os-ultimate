/**
 * src/simulation/riskEstimator.js — Estimateur de risque par skill
 *
 * Attribue un niveau de risque et un score numérique à chaque action
 * avant son exécution réelle. Permet d'éviter des actions dangereuses
 * non intentionnelles et de demander confirmation si nécessaire.
 *
 * Niveaux : LOW < MEDIUM < HIGH < CRITICAL
 * Score   : 0.0 (sans risque) → 1.0 (critique)
 *
 * Aggravations dynamiques :
 *   - Paramètres contenant "rm ", "delete", "drop" → +0.30
 *   - Paramètres contenant "sudo", "chmod"         → +0.20
 */

// ─── Niveaux de risque ────────────────────────────────────────────────────────

export const RiskLevel = {
  LOW:      'low',
  MEDIUM:   'medium',
  HIGH:     'high',
  CRITICAL: 'critical',
};

// ─── Table de risque par skill ────────────────────────────────────────────────

const RISK_MAP = {
  take_screenshot: { level: RiskLevel.LOW,    score: 0.05, sideEffects: [] },
  open_app:        { level: RiskLevel.LOW,    score: 0.1,  sideEffects: ['app_launch'] },
  goto_url:        { level: RiskLevel.LOW,    score: 0.15, sideEffects: ['network_request'] },
  type_text:       { level: RiskLevel.MEDIUM, score: 0.3,  sideEffects: ['keyboard_input'] },
  smart_click:     { level: RiskLevel.MEDIUM, score: 0.35, sideEffects: ['ui_interaction'] },
  run_command:     { level: RiskLevel.HIGH,   score: 0.7,  sideEffects: ['system_exec'] },
  run_shell:       { level: RiskLevel.HIGH,   score: 0.75, sideEffects: ['system_exec', 'file_modify'] },
  http_fetch:      { level: RiskLevel.MEDIUM, score: 0.25, sideEffects: ['network_request'] },
};

// ─── API publique ──────────────────────────────────────────────────────────────

/**
 * Estime le risque d'une action (skill + paramètres).
 *
 * @param {string} skill   — Nom du skill (ex: 'run_shell')
 * @param {object} params  — Paramètres de l'action (analysés pour aggravation)
 * @returns {{
 *   level: string,
 *   score: number,
 *   sideEffects: string[],
 *   requiresConfirmation: boolean
 * }}
 */
export function estimateRisk(skill, params = {}) {
  // Valeur par défaut pour les skills inconnus
  const base = RISK_MAP[skill] || {
    level: RiskLevel.MEDIUM,
    score: 0.4,
    sideEffects: ['unknown'],
  };

  let score = base.score;

  // Analyse textuelle des paramètres pour détecter des patterns dangereux
  const paramStr = JSON.stringify(params).toLowerCase();
  if (paramStr.includes('rm ') || paramStr.includes('delete') || paramStr.includes('drop')) {
    score = Math.min(1.0, score + 0.3);
  }
  if (paramStr.includes('sudo') || paramStr.includes('chmod')) {
    score = Math.min(1.0, score + 0.2);
  }

  // Re-calcule le niveau à partir du score final
  const level =
    score < 0.2 ? RiskLevel.LOW :
    score < 0.5 ? RiskLevel.MEDIUM :
    score < 0.8 ? RiskLevel.HIGH :
                  RiskLevel.CRITICAL;

  return {
    level,
    score:                Math.round(score * 100) / 100,
    sideEffects:          base.sideEffects,
    requiresConfirmation: score >= 0.7,
  };
}
