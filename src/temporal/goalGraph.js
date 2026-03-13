/**
 * src/temporal/goalGraph.js — Graphe de buts (DAG) avec dépendances
 *
 * Stocke les buts comme un DAG orienté acyclique :
 *   - Chaque but peut dépendre d'autres buts (dependencies[])
 *   - Chaque but peut contenir des sous-buts (subgoals[])
 *   - Un but est "exécutable" seulement si toutes ses dépendances sont COMPLETED
 *
 * Persistance : data/goals.json (flush toutes les 30s + flush explicite à delete)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_FILE = join(__dirname, '../../data/goals.json');

// S'assure que le dossier data/ existe
const DATA_DIR = join(__dirname, '../../data');
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

// ─── Statuts possibles d'un but ───────────────────────────────────────────────

export const GoalStatus = {
  PENDING:   'pending',    // En attente d'exécution
  ACTIVE:    'active',     // En cours d'exécution
  COMPLETED: 'completed',  // Terminé avec succès
  FAILED:    'failed',     // Terminé en échec
  BLOCKED:   'blocked',    // Bloqué par dépendances non satisfaites
};

// ─── Cache en RAM + flag dirty ────────────────────────────────────────────────

let _goals = null;
let _dirty = false;

// ─── Chargement / Sauvegarde ──────────────────────────────────────────────────

/**
 * Charge les buts depuis le disque (lazy, mis en cache en RAM).
 * @returns {Array}
 */
function load() {
  if (_goals) return _goals;
  try {
    if (existsSync(DATA_FILE)) {
      _goals = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
      return _goals;
    }
  } catch {}
  _goals = [];
  return _goals;
}

/**
 * Écrit les buts sur le disque si le flag dirty est levé.
 * Silencieux en cas d'erreur I/O.
 */
function flush() {
  if (!_dirty) return;
  try {
    writeFileSync(DATA_FILE, JSON.stringify(_goals, null, 2), 'utf8');
    _dirty = false;
  } catch {}
}

// Flush automatique toutes les 30 secondes — unref() pour ne pas bloquer exit
setInterval(flush, 30000).unref();

// ─── API publique ──────────────────────────────────────────────────────────────

/**
 * Ajoute un nouveau but dans le graphe.
 *
 * @param {object} opts
 * @param {string}   opts.description  — Description du but (max 200 chars)
 * @param {number}   opts.priority     — Priorité 1-10 (défaut 5)
 * @param {string}   opts.deadline     — ISO date limite optionnelle
 * @param {string[]} opts.dependencies — IDs des buts dont celui-ci dépend
 * @param {string[]} opts.subgoals     — IDs des sous-buts
 * @param {number}   opts.reward       — Valeur de récompense (défaut 1.0)
 * @returns {object} Le but créé
 */
export function addGoal({
  description,
  priority = 5,
  deadline = null,
  dependencies = [],
  subgoals = [],
  reward = 1.0,
}) {
  const goals = load();
  const goal = {
    id: `g-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    description: (description || '').slice(0, 200),
    priority: Math.max(1, Math.min(10, priority)),
    deadline: deadline || null,
    dependencies: dependencies || [],
    subgoals: subgoals || [],
    status: GoalStatus.PENDING,
    reward: reward || 1.0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null,
  };
  goals.push(goal);
  _dirty = true;
  return goal;
}

/**
 * Met à jour le statut d'un but.
 * Enregistre completedAt pour les statuts terminaux.
 *
 * @param {string} id
 * @param {string} status — valeur de GoalStatus
 * @returns {boolean} true si trouvé et mis à jour
 */
export function updateGoalStatus(id, status) {
  const goals = load();
  const g = goals.find(g => g.id === id);
  if (!g) return false;
  g.status = status;
  g.updatedAt = new Date().toISOString();
  if (status === GoalStatus.COMPLETED || status === GoalStatus.FAILED) {
    g.completedAt = new Date().toISOString();
  }
  _dirty = true;
  return true;
}

/**
 * Supprime un but du graphe et flush immédiatement.
 *
 * @param {string} id
 * @returns {boolean} true si trouvé et supprimé
 */
export function deleteGoal(id) {
  const goals = load();
  const idx = goals.findIndex(g => g.id === id);
  if (idx === -1) return false;
  goals.splice(idx, 1);
  _dirty = true;
  flush();
  return true;
}

/**
 * Vérifie si toutes les dépendances d'un but sont dans l'état COMPLETED.
 * Un but sans dépendances est toujours prêt.
 *
 * @param {object} goal
 * @returns {boolean}
 */
export function areDependenciesMet(goal) {
  const goals = load();
  return (goal.dependencies || []).every(depId => {
    const dep = goals.find(g => g.id === depId);
    return dep?.status === GoalStatus.COMPLETED;
  });
}

/**
 * Retourne tous les buts (référence au tableau en RAM).
 * @returns {Array}
 */
export function getAllGoals() {
  return load();
}

/**
 * Retourne un but par son ID, ou null si introuvable.
 * @param {string} id
 * @returns {object|null}
 */
export function getGoal(id) {
  return load().find(g => g.id === id) || null;
}

/**
 * Vide tous les buts (utile pour les tests).
 */
export function _resetGoals() {
  _goals = [];
  _dirty = false;
}
