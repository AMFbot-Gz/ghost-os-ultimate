/**
 * Tests temporal — goalGraph + scheduler + priorityEngine
 *
 * Chaque test réinitialise l'état interne via _resetGoals() pour être isolé.
 */
import { jest } from '@jest/globals';
import {
  addGoal,
  updateGoalStatus,
  deleteGoal,
  getAllGoals,
  getGoal,
  GoalStatus,
  areDependenciesMet,
  _resetGoals,
} from '../../src/temporal/goalGraph.js';
import { nextMission, getSchedule } from '../../src/temporal/scheduler.js';
import { calculatePriority } from '../../src/temporal/priorityEngine.js';

// Réinitialise le DAG avant chaque test
beforeEach(() => { _resetGoals(); });

// ─── addGoal ──────────────────────────────────────────────────────────────────

describe('addGoal', () => {
  test('crée un but avec les champs obligatoires', () => {
    const g = addGoal({ description: 'Faire le café' });
    expect(g).toMatchObject({
      description: 'Faire le café',
      status:      GoalStatus.PENDING,
      priority:    5,
      reward:      1.0,
    });
    expect(g.id).toMatch(/^g-/);
    expect(g.createdAt).toBeTruthy();
    expect(getAllGoals()).toHaveLength(1);
  });

  test('plafonne la priorité entre 1 et 10', () => {
    const low  = addGoal({ description: 'test',  priority: -5 });
    const high = addGoal({ description: 'test2', priority: 99 });
    expect(low.priority).toBe(1);
    expect(high.priority).toBe(10);
  });

  test('tronque la description à 200 chars', () => {
    const longDesc = 'x'.repeat(300);
    const g = addGoal({ description: longDesc });
    expect(g.description).toHaveLength(200);
  });
});

// ─── Dépendances (DAG) ────────────────────────────────────────────────────────

describe('areDependenciesMet', () => {
  test('retourne true si pas de dépendances', () => {
    const g = addGoal({ description: 'Indépendant' });
    expect(areDependenciesMet(g)).toBe(true);
  });

  test('retourne false si une dépendance est PENDING', () => {
    const dep  = addGoal({ description: 'Prérequis' });
    const goal = addGoal({ description: 'Bloqué', dependencies: [dep.id] });
    expect(areDependenciesMet(goal)).toBe(false);
  });

  test('retourne true une fois la dépendance COMPLETED', () => {
    const dep  = addGoal({ description: 'Prérequis' });
    const goal = addGoal({ description: 'Débloqué', dependencies: [dep.id] });
    updateGoalStatus(dep.id, GoalStatus.COMPLETED);
    expect(areDependenciesMet(goal)).toBe(true);
  });
});

// ─── updateGoalStatus / deleteGoal ────────────────────────────────────────────

describe('updateGoalStatus', () => {
  test('met à jour le statut et updatedAt', () => {
    const g = addGoal({ description: 'Test statut' });
    const result = updateGoalStatus(g.id, GoalStatus.ACTIVE);
    expect(result).toBe(true);
    expect(getGoal(g.id).status).toBe(GoalStatus.ACTIVE);
    expect(getGoal(g.id).updatedAt).toBeTruthy();
  });

  test('retourne false pour un id inconnu', () => {
    expect(updateGoalStatus('g-inexistant', GoalStatus.COMPLETED)).toBe(false);
  });
});

// ─── nextMission ──────────────────────────────────────────────────────────────

describe('nextMission', () => {
  test('retourne null si aucun but disponible', () => {
    expect(nextMission()).toBeNull();
  });

  test('retourne le but de plus haute priorité sans dépendances', () => {
    addGoal({ description: 'Priorité basse', priority: 2 });
    const haute = addGoal({ description: 'Priorité haute', priority: 9 });
    const next = nextMission();
    expect(next.id).toBe(haute.id);
  });

  test('ignore les buts bloqués par des dépendances non satisfaites', () => {
    // dep a priorité 9 et est libre → sélectionné en premier
    // goal a priorité 8 mais dépend de dep → bloqué, ne doit jamais être choisi
    const dep  = addGoal({ description: 'Prérequis',   priority: 9 });
    const goal = addGoal({ description: 'Bloqué',      priority: 8, dependencies: [dep.id] });
    addGoal({ description: 'Libre', priority: 3 });
    const next = nextMission();
    // Le but bloqué (priorité 8) ne doit pas être sélectionné
    expect(next.id).not.toBe(goal.id);
    // Le prérequis (libre, priorité 9) est le seul candidat prioritaire
    expect(next.id).toBe(dep.id);
  });
});

// ─── getSchedule ──────────────────────────────────────────────────────────────

describe('getSchedule', () => {
  test('retourne les buts PENDING triés par priorité décroissante', () => {
    addGoal({ description: 'P3', priority: 3 });
    addGoal({ description: 'P7', priority: 7 });
    addGoal({ description: 'P1', priority: 1 });
    const schedule = getSchedule();
    expect(schedule[0].priority).toBeGreaterThanOrEqual(schedule[1].priority);
    expect(schedule[1].priority).toBeGreaterThanOrEqual(schedule[2].priority);
  });

  test('marque readyToExecute correctement', () => {
    const dep  = addGoal({ description: 'Dep',    priority: 5 });
    const goal = addGoal({ description: 'Bloqué', priority: 5, dependencies: [dep.id] });
    const libre = addGoal({ description: 'Libre', priority: 5 });
    const schedule = getSchedule();
    const blockedEntry = schedule.find(s => s.id === goal.id);
    const freeEntry    = schedule.find(s => s.id === libre.id);
    expect(blockedEntry.readyToExecute).toBe(false);
    expect(freeEntry.readyToExecute).toBe(true);
  });
});
