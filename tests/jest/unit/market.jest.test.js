/**
 * test/unit/market.jest.test.js — Tests unitaires du marché d'agents
 *
 * Couvre : auction, réputation, bid scoring, dispatch
 */

import { jest } from '@jest/globals';

// ─── Imports ──────────────────────────────────────────────────────────────────
const { runAuction } = await import('../../src/market/auctionEngine.js');
const { recordOutcome, getReputation, _resetScores } = await import('../../src/market/reputationSystem.js');
const { registerAgent, dispatchWithAuction, marketStats } = await import('../../src/market/agentMarket.js');

beforeEach(() => {
  _resetScores();
});

// ─── Tests réputation ─────────────────────────────────────────────────────────

describe('market — reputationSystem', () => {
  test('getReputation() retourne valeurs par défaut pour agent inconnu', () => {
    const rep = getReputation('unknown-agent');
    expect(rep.reputation).toBe(0.5);
    expect(rep.totalCount).toBe(0);
    expect(rep.successCount).toBe(0);
  });

  test('recordOutcome() augmente le successCount et recalcule la réputation', () => {
    recordOutcome('agent-a', { success: true, latencyMs: 100 });
    recordOutcome('agent-a', { success: true, latencyMs: 100 });
    recordOutcome('agent-a', { success: false, latencyMs: 100 });

    const rep = getReputation('agent-a');
    expect(rep.totalCount).toBe(3);
    expect(rep.successCount).toBe(2);
    // successRate = 2/3 ≈ 0.667, réputation doit être > 0.5
    expect(rep.reputation).toBeGreaterThan(0.5);
  });
});

// ─── Tests enchères ───────────────────────────────────────────────────────────

describe('market — auctionEngine', () => {
  test('runAuction() retourne null si aucun candidat', () => {
    const result = runAuction({ type: 'code' }, []);
    expect(result).toBeNull();
  });

  test('runAuction() désigne un gagnant parmi plusieurs candidats', () => {
    const candidates = [
      { id: 'agent-1', specialization: ['code'] },
      { id: 'agent-2', specialization: ['vision'] },
      { id: 'agent-3', specialization: ['code', 'analysis'] },
    ];
    const result = runAuction({ type: 'code' }, candidates);
    expect(result).toBeDefined();
    expect(result.winner).toBeDefined();
    expect(result.winner.id).toBeDefined();
    expect(Array.isArray(result.allBids)).toBe(true);
    expect(result.allBids.length).toBe(3);
  });

  test('runAuction() favorise le spécialiste : bonus specialization × 1.2', () => {
    // Agent A est spécialisé en "code", agent B non
    // On leur donne la même réputation (aucun historique)
    const candidates = [
      { id: 'specialist', specialization: ['code'], latencyEstimate: 500 },
      { id: 'generalist', specialization: ['other'], latencyEstimate: 500 },
    ];
    const result = runAuction({ type: 'code' }, candidates);
    expect(result.winner.id).toBe('specialist');
  });

  test('runAuction() classe les bids par ordre décroissant', () => {
    const candidates = [
      { id: 'a1', latencyEstimate: 1000 },
      { id: 'a2', latencyEstimate: 500 },
      { id: 'a3', latencyEstimate: 200 },
    ];
    // Donner un meilleur historique à a3
    recordOutcome('a3', { success: true, latencyMs: 200 });
    recordOutcome('a3', { success: true, latencyMs: 200 });

    const result = runAuction({ type: 'analysis' }, candidates);
    // Les bids doivent être triés décroissant
    for (let i = 0; i < result.allBids.length - 1; i++) {
      expect(result.allBids[i].bid).toBeGreaterThanOrEqual(result.allBids[i + 1].bid);
    }
  });

  test('dispatchWithAuction() appelle runFn avec le winner et enregistre le résultat', async () => {
    registerAgent({ id: 'market-agent-1', specialization: ['test'], latencyEstimate: 300 });
    registerAgent({ id: 'market-agent-2', specialization: ['test'], latencyEstimate: 800 });

    const runFn = jest.fn().mockResolvedValue({ success: true, output: 'done' });
    const result = await dispatchWithAuction(
      { type: 'test' },
      { runFn }
    );

    expect(result.success).toBe(true);
    expect(result.winnerId).toBeDefined();
    expect(runFn).toHaveBeenCalledTimes(1);

    // La réputation du gagnant doit avoir été mise à jour
    const rep = getReputation(result.winnerId);
    expect(rep.totalCount).toBe(1);
    expect(rep.successCount).toBe(1);
  });
});
