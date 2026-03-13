/**
 * worldmodel/index.js — World model des interfaces macOS
 *
 * Mémoire structurelle des éléments UI : chaque fois qu'un élément est
 * trouvé ou manqué, on enregistre l'expérience pour construire un modèle
 * de fiabilité par app + fenêtre.
 *
 * Persistance sur disque dans data/worldmodel.json (flush toutes les 30s).
 *
 * Structure JSON :
 * {
 *   "Safari": {
 *     "windows": {
 *       "main": {
 *         "elements": [
 *           { elementQuery, position, role, reliability, successCount, totalCount,
 *             learnedAt, lastSeen }
 *         ]
 *       }
 *     }
 *   }
 * }
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_FILE = join(__dirname, '../../data/worldmodel.json');

// Modèle en RAM — chargé à la première utilisation
let _model = null;
// Flag dirty — évite les écritures inutiles
let _dirty = false;

/**
 * Charge le modèle depuis le disque (lazy).
 * @returns {object}
 */
function load() {
  if (_model) return _model;
  try {
    if (existsSync(DATA_FILE)) {
      _model = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
      return _model;
    }
  } catch {
    // Fichier corrompu ou inexistant → repart de zéro
  }
  _model = {};
  return _model;
}

/**
 * Écrit le modèle sur disque si des modifications sont en attente.
 * Crée le répertoire data/ si nécessaire.
 */
function flush() {
  if (!_dirty) return;
  try {
    // S'assure que le répertoire data/ existe
    const dataDir = dirname(DATA_FILE);
    if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

    writeFileSync(DATA_FILE, JSON.stringify(_model, null, 2), 'utf8');
    _dirty = false;
  } catch {
    // Erreur I/O silencieuse — les données restent en RAM
  }
}

// Flush automatique toutes les 30s — unref() pour ne pas bloquer l'exit
setInterval(flush, 30000).unref();

// ─── API publique ──────────────────────────────────────────────────────────────

/**
 * Enregistre ou met à jour un élément UI connu pour une app + fenêtre.
 * Calcule un score de fiabilité basé sur le ratio succès/total.
 * Applique une décroissance si l'élément n'a pas été vu depuis > 7 jours.
 *
 * @param {object} opts
 * @param {string}  opts.app           — nom de l'application
 * @param {string}  [opts.windowTitle] — titre de la fenêtre (défaut: 'main')
 * @param {string}  opts.elementQuery  — requête sémantique utilisée pour trouver l'élément
 * @param {object}  [opts.position]    — {x, y} position à l'écran si connue
 * @param {boolean} opts.success       — true si l'action a réussi
 */
export function recordElement({ app, windowTitle = 'main', elementQuery, position, success }) {
  const m = load();

  // Initialise la structure si nécessaire
  if (!m[app]) m[app] = { windows: {} };
  if (!m[app].windows[windowTitle]) m[app].windows[windowTitle] = { elements: [] };

  const elements = m[app].windows[windowTitle].elements;
  const existing = elements.find(e => e.elementQuery === elementQuery);

  if (existing) {
    existing.successCount = (existing.successCount || 0) + (success ? 1 : 0);
    existing.totalCount = (existing.totalCount || 0) + 1;
    existing.reliability = existing.successCount / existing.totalCount;
    if (position) existing.position = position;
    existing.lastSeen = new Date().toISOString();

    // Décroissance temporelle si l'élément n'a pas été vu depuis > 7 jours
    const age = Date.now() - new Date(existing.lastSeen).getTime();
    if (age > 7 * 24 * 3600 * 1000) existing.reliability *= 0.9;
  } else {
    elements.push({
      elementQuery,
      position: position || null,
      role: 'unknown',
      reliability: success ? 1.0 : 0.0,
      successCount: success ? 1 : 0,
      totalCount: 1,
      learnedAt: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
    });
  }

  _dirty = true;
}

/**
 * Cherche un élément connu pour une app + fenêtre donnée.
 *
 * @param {string} app
 * @param {string} elementQuery
 * @param {string} [windowTitle]
 * @returns {object|null}
 */
export function lookupElement(app, elementQuery, windowTitle = 'main') {
  const m = load();
  const elements = m[app]?.windows?.[windowTitle]?.elements || [];
  return elements.find(e => e.elementQuery === elementQuery) || null;
}

/**
 * Retourne le modèle complet d'une app (toutes les fenêtres et éléments).
 *
 * @param {string} app
 * @returns {object|null}
 */
export function getAppModel(app) {
  const m = load();
  return m[app] || null;
}

/**
 * Supprime le modèle d'une app et force un flush immédiat.
 *
 * @param {string} app
 * @returns {boolean} true si l'app existait et a été supprimée
 */
export function forgetApp(app) {
  const m = load();
  if (m[app]) {
    delete m[app];
    _dirty = true;
    flush();
    return true;
  }
  return false;
}

/**
 * Statistiques globales du world model.
 * @returns {{ apps: number, totalElements: number, highReliability: number, coverage: number }}
 */
export function worldModelStats() {
  const m = load();
  const apps = Object.keys(m);
  let totalElements = 0;
  let highReliability = 0;

  for (const app of apps) {
    for (const win of Object.values(m[app]?.windows || {})) {
      totalElements += win.elements?.length || 0;
      highReliability += (win.elements || []).filter(e => e.reliability > 0.8).length;
    }
  }

  return {
    apps: apps.length,
    totalElements,
    highReliability,
    coverage: totalElements > 0 ? highReliability / totalElements : 0,
  };
}

// Exposé pour les tests (reset du modèle en RAM sans toucher le disque)
export function _resetForTests() {
  _model = {};  // objet vide, évite la relecture depuis le disque
  _dirty = false;
}
