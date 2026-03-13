/**
 * src/temporal/index.js — Point d'entrée du module Temporal Reasoner
 *
 * Exporte les trois sous-systèmes :
 *   - goalGraph    : CRUD du DAG de buts + vérification dépendances
 *   - scheduler    : Ordonnancement multi-critères (nextMission, getSchedule)
 *   - priorityEngine : Calcul de priorité dynamique (deadline + contexte)
 */

export {
  addGoal,
  updateGoalStatus,
  deleteGoal,
  getAllGoals,
  getGoal,
  GoalStatus,
} from './goalGraph.js';

export { nextMission, getSchedule } from './scheduler.js';
export { calculatePriority } from './priorityEngine.js';
