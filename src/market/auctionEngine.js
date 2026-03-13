/**
 * src/market/auctionEngine.js — Moteur d'enchères pour l'allocation des tâches
 *
 * Formule de score :
 *   utility = (successRate × reputation) / log(latency + 1)
 *   bid     = utility × specializationBonus (×1.2 si spécialisation correspond)
 *
 * L'agent avec le bid le plus élevé remporte la tâche.
 */

import { getReputation } from './reputationSystem.js';

/**
 * Lance une enchère et désigne le meilleur agent pour une tâche.
 *
 * @param {{ type?: string }} task — Tâche à allouer
 * @param {Array<{ id: string, specialization?: string[], model?: string, latencyEstimate?: number, cost?: number }>} candidates
 * @returns {{ winner: Object, allBids: Object[] } | null}
 */
export function runAuction(task, candidates) {
  if (!candidates || candidates.length === 0) return null;

  const bids = candidates.map(agent => {
    const rep = getReputation(agent.id);

    // Taux de succès historique (défaut 0.5 si pas de données)
    const successRate = rep.totalCount > 0
      ? rep.successCount / rep.totalCount
      : 0.5;

    // Latence estimée : préférer la mesure de l'agent, sinon l'historique
    const latency = agent.latencyEstimate || rep.avgLatencyMs || 1000;

    // Score d'utilité : successRate × réputation / log(latence+1)
    const utility = (successRate * rep.reputation) / Math.log(latency + 1);

    // Bonus de spécialisation : +20% si l'agent est spécialisé dans ce type de tâche
    const specializationBonus =
      task.type && agent.specialization?.includes(task.type) ? 1.2 : 1.0;

    return {
      ...agent,
      bid: utility * specializationBonus,
      utility,
      successRate,
      reputation: rep.reputation,
    };
  });

  // Tri décroissant par bid — le meilleur enchérisseur en tête
  bids.sort((a, b) => b.bid - a.bid);

  return { winner: bids[0], allBids: bids };
}
