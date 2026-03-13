/**
 * test/unit/swarm.jest.test.js — Tests unitaires du swarm distribué
 *
 * Couvre : nodeRegistry, selectNode, fallback local, stats
 */

import { jest } from '@jest/globals';

// ─── Mock fetch ───────────────────────────────────────────────────────────────
// Par défaut : /api/tags retourne deux modèles disponibles
global.fetch = jest.fn().mockResolvedValue({
  ok: true,
  json: async () => ({ models: [{ name: 'llama3:latest' }, { name: 'llama3.2:3b' }] }),
});

// ─── Imports après mock ───────────────────────────────────────────────────────
const { nodeRegistry } = await import('../../src/swarm/nodeRegistry.js');
const { selectNode } = await import('../../src/swarm/nodeRouter.js');

// Initialisation avant les tests
beforeAll(async () => {
  await nodeRegistry.init();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('swarm — nodeRegistry', () => {
  test('getAll() retourne au moins un nœud', () => {
    const nodes = nodeRegistry.getAll();
    expect(Array.isArray(nodes)).toBe(true);
    expect(nodes.length).toBeGreaterThan(0);
  });

  test('get("mac-local") retourne le nœud principal', () => {
    const node = nodeRegistry.get('mac-local');
    expect(node).toBeDefined();
    expect(node.id).toBe('mac-local');
  });

  test('stats() retourne un objet avec total, up, down, totalCapacity, activeJobs', () => {
    const s = nodeRegistry.stats();
    expect(s).toHaveProperty('total');
    expect(s).toHaveProperty('up');
    expect(s).toHaveProperty('down');
    expect(s).toHaveProperty('totalCapacity');
    expect(s).toHaveProperty('activeJobs');
    expect(typeof s.total).toBe('number');
    expect(s.total).toBeGreaterThan(0);
  });
});

describe('swarm — selectNode', () => {
  test('selectNode() retourne un nœud (objet avec id et url)', () => {
    const node = selectNode('llama3:latest');
    expect(node).toBeDefined();
    expect(node).toHaveProperty('id');
    expect(node).toHaveProperty('url');
  });

  test('selectNode() fallback sur mac-local quand aucun nœud disponible', () => {
    // Simuler tous les nœuds surchargés
    const all = nodeRegistry.getAll();
    const savedJobs = all.map(n => n.activeJobs);
    all.forEach(n => { n.activeJobs = n.maxConcurrency; });

    const node = selectNode('llama3:latest', 'least_loaded');
    // Le fallback doit quand même retourner mac-local
    expect(node).toBeDefined();
    expect(node.id).toBe('mac-local');

    // Restaurer
    all.forEach((n, i) => { n.activeJobs = savedJobs[i]; });
  });
});
