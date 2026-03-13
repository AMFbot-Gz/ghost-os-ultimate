/**
 * src/temporal/priorityEngine.js — Moteur de calcul de priorité dynamique
 *
 * Ajuste la priorité d'un but en fonction du contexte :
 *   - Urgence deadline (bonus +1 à +4)
 *   - But bloquant d'autres buts (bonus +2)
 *
 * Le résultat est plafonné à 10 (priorité maximale).
 */

/**
 * Calcule la priorité effective d'un but en tenant compte du contexte.
 *
 * @param {object} goal                       — But à évaluer
 * @param {object} context                    — Contexte d'exécution
 * @param {boolean} context.isBlockingOthers  — true si d'autres buts dépendent de celui-ci
 * @returns {number} Priorité ajustée (1–10)
 */
export function calculatePriority(goal, context = {}) {
  let score = goal.priority || 5;

  // Bonus urgence deadline
  if (goal.deadline) {
    const hoursLeft = (new Date(goal.deadline).getTime() - Date.now()) / 3600000;
    if (hoursLeft < 1)         score += 4; // Critique : moins d'1h
    else if (hoursLeft < 24)   score += 2; // Urgent : moins de 24h
    else if (hoursLeft < 168)  score += 1; // Bientôt : moins de 7 jours
  }

  // Bonus si ce but est un prérequis d'autres buts non complétés
  if (context.isBlockingOthers) score += 2;

  // Plafonne à la valeur maximale
  return Math.min(10, score);
}
