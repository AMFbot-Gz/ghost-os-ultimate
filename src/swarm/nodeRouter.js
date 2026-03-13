/**
 * src/swarm/nodeRouter.js — Sélection intelligente du nœud Ollama
 *
 * Stratégies disponibles :
 *  - least_loaded   : ratio activeJobs/maxConcurrency le plus bas (défaut)
 *  - round_robin    : sélection aléatoire parmi les nœuds disponibles
 *  - latency_aware  : nœud avec la latence EWMA la plus faible
 */

import { nodeRegistry } from './nodeRegistry.js';

/**
 * Sélectionne le meilleur nœud pour un modèle donné selon la stratégie choisie.
 *
 * @param {string} [requiredModel]
 * @param {'least_loaded'|'round_robin'|'latency_aware'} [strategy]
 * @returns {Object|null} NodeState ou null si aucun nœud disponible
 */
export function selectNode(requiredModel, strategy = 'least_loaded') {
  const available = nodeRegistry.getAvailable(requiredModel);

  if (available.length === 0) {
    // Fallback : nœud local même si chargé ou status inconnu
    const local = nodeRegistry.get('mac-local');
    return local || null;
  }

  switch (strategy) {
    case 'round_robin':
      return available[Math.floor(Math.random() * available.length)];

    case 'latency_aware':
      return available.slice().sort((a, b) => a.avgLatencyMs - b.avgLatencyMs)[0];

    case 'least_loaded':
    default:
      return available.slice().sort(
        (a, b) => (a.activeJobs / a.maxConcurrency) - (b.activeJobs / b.maxConcurrency)
      )[0];
  }
}

/**
 * Exécute un appel Ollama /api/generate sur un nœud spécifique.
 * Gère le compteur activeJobs et met à jour la latence EWMA.
 *
 * @param {string} nodeId
 * @param {string} model
 * @param {string} prompt
 * @param {Object} [opts]
 * @param {number} [opts.timeout]
 * @returns {Promise<{ success: boolean, text?: string, model: string, nodeId: string, error?: string }>}
 */
export async function callOnNode(nodeId, model, prompt, opts = {}) {
  const node = nodeRegistry.get(nodeId);
  if (!node) throw new Error(`Node ${nodeId} not found`);

  node.activeJobs++;
  const t = Date.now();

  try {
    const r = await fetch(`${node.url}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt, stream: false, ...opts }),
      signal: AbortSignal.timeout(opts.timeout || 60000),
    });

    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();

    // Mise à jour latence EWMA (80% ancien + 20% mesure)
    node.avgLatencyMs = Math.round(0.8 * node.avgLatencyMs + 0.2 * (Date.now() - t));

    return { success: true, text: data.response, model, nodeId };
  } catch (e) {
    return { success: false, error: e.message, model, nodeId };
  } finally {
    node.activeJobs = Math.max(0, node.activeJobs - 1);
  }
}
