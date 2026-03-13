/**
 * src/temporal/scheduler.js — Ordonnanceur de buts basé sur DAG + priorités
 *
 * Sélectionne le prochain but à exécuter selon trois critères pondérés :
 *   1. Priorité intrinsèque (0.4)
 *   2. Urgence deadline — fenêtre 7 jours (0.4)
 *   3. Reward normalisée (0.1)
 *
 * Un but n'est candidat que s'il est PENDING et que ses dépendances sont toutes COMPLETED.
 */

import { getAllGoals, areDependenciesMet, GoalStatus } from './goalGraph.js';

/**
 * Calcule le score d'un but candidat pour l'ordonnancement.
 *
 * @param {object} goal
 * @returns {number} score entre 0 et 1
 */
function scoreGoal(goal) {
  const now = Date.now();

  // Urgence deadline : 1.0 si deadline dépassée, 0 si > 7 jours
  const deadlineUrgency = goal.deadline
    ? Math.max(0, 1 - (new Date(goal.deadline).getTime() - now) / (7 * 24 * 3600 * 1000))
    : 0;

  return (
    (goal.priority / 10) * 0.4 +
    deadlineUrgency * 0.4 +
    ((goal.reward || 1) * 0.1) / 10
  );
}

/**
 * Sélectionne le prochain but à exécuter.
 *
 * @returns {object|null} Le but avec le score le plus élevé, ou null si aucun candidat
 */
export function nextMission() {
  const goals = getAllGoals();

  // Filtre les buts exécutables : pending + dépendances satisfaites
  const candidates = goals.filter(
    g => g.status === GoalStatus.PENDING && areDependenciesMet(g)
  );

  if (candidates.length === 0) return null;

  // Calcule et trie par score décroissant
  const scored = candidates.map(g => ({ ...g, score: scoreGoal(g) }));
  scored.sort((a, b) => b.score - a.score);

  return scored[0] || null;
}

/**
 * Retourne le planning complet de tous les buts PENDING.
 * Chaque entrée indique si le but est prêt à être exécuté.
 * Trié par priorité décroissante.
 *
 * @returns {Array<object>}
 */
export function getSchedule() {
  const goals = getAllGoals();
  const pending = goals.filter(g => g.status === GoalStatus.PENDING);

  return pending
    .map(g => ({
      ...g,
      dependenciesMet: areDependenciesMet(g),
      readyToExecute: g.status === GoalStatus.PENDING && areDependenciesMet(g),
    }))
    .sort((a, b) => b.priority - a.priority);
}
