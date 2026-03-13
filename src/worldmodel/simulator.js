/**
 * simulator.js — Simulation de plan avant exécution
 *
 * Enrichit chaque step d'un plan avec des métadonnées prédictives :
 * - si l'élément est connu et fiable → on peut bypasser la perception complète
 * - si l'élément est inconnu → on marque le step comme risqué
 *
 * Retourne un score de confiance global pour le plan entier.
 */

import { lookupElement } from './index.js';

/**
 * Durées estimées par défaut pour chaque skill (en ms).
 * Utilisé pour les steps sans perception d'élément.
 */
function getStepEstimateMs(skill) {
  const estimates = {
    take_screenshot: 300,
    open_app: 2000,
    goto_url: 3000,
    run_command: 5000,
    http_fetch: 2000,
    read_file: 100,
    type_text: 500,
    press_key: 100,
    press_enter: 100,
  };
  return estimates[skill] ?? 1000;
}

/**
 * Simule un plan de steps avant exécution.
 * Enrichit chaque step avec des méta-données issues du world model.
 *
 * @param {Array<{skill: string, params: object}>} steps — plan à simuler
 * @returns {{
 *   enrichedPlan: Array,
 *   confidence: number,       — score 0..1 (arrondi à 2 décimales)
 *   estimatedDurationMs: number,
 *   riskySteps: Array
 * }}
 */
export function simulatePlan(steps) {
  const enrichedPlan = [];
  let totalEstimatedMs = 0;
  const riskySteps = [];
  let confidence = 1.0;

  for (const step of steps) {
    const enriched = { ...step, _simulated: true };

    // Skills qui nécessitent de trouver un élément UI
    if (['find_element', 'smart_click', 'wait_for_element'].includes(step.skill)) {
      const query = step.params?.query || step.params?.element;
      const app = step.params?.app || 'unknown';
      const known = lookupElement(app, query);

      if (known && known.reliability > 0.8) {
        // Élément connu et fiable → on peut sauter la perception complète
        enriched._knownElement = known;
        enriched._skipPerception = true;
        enriched._estimatedMs = 50; // Très rapide : position déjà connue
        confidence = Math.min(confidence, known.reliability);
      } else {
        // Élément inconnu ou peu fiable → perception complète requise
        enriched._skipPerception = false;
        enriched._estimatedMs = 1500;
        confidence *= 0.7;
        if (!known) {
          riskySteps.push({ step: step.skill, reason: 'element_unknown' });
        }
      }
    } else {
      enriched._estimatedMs = getStepEstimateMs(step.skill);
    }

    totalEstimatedMs += enriched._estimatedMs;
    enrichedPlan.push(enriched);
  }

  return {
    enrichedPlan,
    confidence: Math.round(confidence * 100) / 100,
    estimatedDurationMs: totalEstimatedMs,
    riskySteps,
  };
}
