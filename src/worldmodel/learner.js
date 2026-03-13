/**
 * learner.js — Apprentissage automatique depuis les actions exécutées
 *
 * À appeler après chaque action find_element / smart_click / wait_for_element
 * pour alimenter le world model avec le résultat (succès/échec + position).
 */

import { recordElement } from './index.js';

/**
 * Apprend depuis le résultat d'une action de perception.
 * Ne fait rien pour les skills qui ne touchent pas les éléments UI.
 *
 * @param {object} opts
 * @param {string} opts.skill        — nom du skill exécuté
 * @param {object} opts.params       — paramètres passés au skill
 * @param {object} opts.result       — résultat retourné par le skill
 * @param {string} [opts.app]        — nom de l'application cible
 * @param {string} [opts.windowTitle]— titre de la fenêtre cible
 */
export function learnFromAction({ skill, params, result, app, windowTitle }) {
  // Filtre : seuls les skills de perception d'éléments nous intéressent
  if (!['find_element', 'smart_click', 'wait_for_element'].includes(skill)) return;

  const query = params?.query || params?.element;
  if (!query) return;

  recordElement({
    app: app || params?.app || 'unknown',
    windowTitle: windowTitle || 'main',
    elementQuery: query,
    position: result?.x != null && result?.y != null
      ? { x: result.x, y: result.y }
      : null,
    success: result?.success !== false,
  });
}
