/**
 * Tests worldmodel — World model neuro-symbolique
 *
 * Couvre : recordElement, lookupElement, worldModelStats, forgetApp
 * et simulatePlan (avec/sans éléments connus).
 */

import { recordElement, lookupElement, worldModelStats, forgetApp, _resetForTests } from '../../src/worldmodel/index.js';
import { simulatePlan } from '../../src/worldmodel/simulator.js';

// Réinitialise le modèle en RAM avant chaque test
// pour garantir l'isolation (pas d'état partagé entre tests)
beforeEach(() => {
  _resetForTests();
});

describe('worldmodel — recordElement & lookupElement', () => {
  test('lookup retourne null si aucun élément enregistré', () => {
    const result = lookupElement('Safari', 'bouton Valider');
    expect(result).toBeNull();
  });

  test('recordElement crée une entrée et lookup la retrouve', () => {
    recordElement({
      app: 'Safari',
      windowTitle: 'main',
      elementQuery: 'champ de recherche',
      position: { x: 400, y: 100 },
      success: true,
    });

    const found = lookupElement('Safari', 'champ de recherche');
    expect(found).not.toBeNull();
    expect(found.elementQuery).toBe('champ de recherche');
    expect(found.reliability).toBe(1.0);
    expect(found.successCount).toBe(1);
    expect(found.totalCount).toBe(1);
    expect(found.position).toEqual({ x: 400, y: 100 });
  });

  test('recordElement met à jour la fiabilité sur plusieurs appels', () => {
    // 2 succès + 1 échec → reliability = 2/3
    recordElement({ app: 'Finder', elementQuery: 'barre latérale', success: true });
    recordElement({ app: 'Finder', elementQuery: 'barre latérale', success: true });
    recordElement({ app: 'Finder', elementQuery: 'barre latérale', success: false });

    const found = lookupElement('Finder', 'barre latérale');
    expect(found.totalCount).toBe(3);
    expect(found.successCount).toBe(2);
    expect(found.reliability).toBeCloseTo(2 / 3, 5);
  });

  test('forgetApp supprime une app connue et retourne true', () => {
    recordElement({ app: 'Terminal', elementQuery: 'prompt', success: true });
    expect(lookupElement('Terminal', 'prompt')).not.toBeNull();

    const removed = forgetApp('Terminal');
    expect(removed).toBe(true);
    expect(lookupElement('Terminal', 'prompt')).toBeNull();
  });

  test('forgetApp retourne false pour une app inconnue', () => {
    const result = forgetApp('AppInexistante_xyz_987');
    expect(result).toBe(false);
  });
});

describe('worldmodel — worldModelStats', () => {
  test('stats à zéro sur modèle vide', () => {
    const stats = worldModelStats();
    expect(stats.apps).toBe(0);
    expect(stats.totalElements).toBe(0);
    expect(stats.highReliability).toBe(0);
    expect(stats.coverage).toBe(0);
  });

  test('stats reflètent les éléments enregistrés', () => {
    // 3 éléments fiables + 1 peu fiable
    recordElement({ app: 'Chrome', elementQuery: 'barre d\'adresse', success: true });
    recordElement({ app: 'Chrome', elementQuery: 'onglet 1', success: true });
    recordElement({ app: 'Chrome', elementQuery: 'bouton retour', success: true });
    recordElement({ app: 'Chrome', elementQuery: 'bouton inconnu', success: false });

    const stats = worldModelStats();
    expect(stats.apps).toBe(1);
    expect(stats.totalElements).toBe(4);
    // 3 éléments avec reliability = 1.0 (> 0.8), 1 avec 0.0
    expect(stats.highReliability).toBe(3);
    expect(stats.coverage).toBeCloseTo(0.75, 5);
  });
});

describe('simulatePlan', () => {
  test('plan vide retourne confiance 1.0 et durée 0', () => {
    const result = simulatePlan([]);
    expect(result.confidence).toBe(1.0);
    expect(result.estimatedDurationMs).toBe(0);
    expect(result.enrichedPlan).toHaveLength(0);
    expect(result.riskySteps).toHaveLength(0);
  });

  test('step find_element avec élément inconnu → risky + confiance réduite', () => {
    // Modèle vide → élément inconnu
    const steps = [
      { skill: 'find_element', params: { query: 'bouton inexistant', app: 'Safari' } },
    ];
    const result = simulatePlan(steps);

    expect(result.confidence).toBeCloseTo(0.7, 5);
    expect(result.riskySteps).toHaveLength(1);
    expect(result.riskySteps[0].reason).toBe('element_unknown');
    expect(result.enrichedPlan[0]._skipPerception).toBe(false);
    expect(result.enrichedPlan[0]._estimatedMs).toBe(1500);
  });

  test('step find_element avec élément fiable → skipPerception + confiance haute', () => {
    // Enregistre l'élément comme très fiable
    recordElement({ app: 'Safari', elementQuery: 'champ URL', success: true });
    recordElement({ app: 'Safari', elementQuery: 'champ URL', success: true });
    recordElement({ app: 'Safari', elementQuery: 'champ URL', success: true });

    const steps = [
      { skill: 'find_element', params: { query: 'champ URL', app: 'Safari' } },
    ];
    const result = simulatePlan(steps);

    expect(result.enrichedPlan[0]._skipPerception).toBe(true);
    expect(result.enrichedPlan[0]._estimatedMs).toBe(50);
    expect(result.confidence).toBeGreaterThan(0.8);
    expect(result.riskySteps).toHaveLength(0);
  });

  test('plan mixte : step connu + step non-perception → durée et confiance correctes', () => {
    recordElement({ app: 'Finder', elementQuery: 'icône Bureau', success: true });
    recordElement({ app: 'Finder', elementQuery: 'icône Bureau', success: true });

    const steps = [
      { skill: 'find_element', params: { query: 'icône Bureau', app: 'Finder' } },
      { skill: 'take_screenshot', params: {} },
    ];
    const result = simulatePlan(steps);

    // Step 1 : connu → 50ms, step 2 : take_screenshot → 300ms
    expect(result.estimatedDurationMs).toBe(50 + 300);
    expect(result.enrichedPlan).toHaveLength(2);
    expect(result.enrichedPlan[1]._estimatedMs).toBe(300);
  });
});
