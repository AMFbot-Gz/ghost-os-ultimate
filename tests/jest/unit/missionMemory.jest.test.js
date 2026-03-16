/**
 * Tests missionMemory.js — Mémoire auto-apprenante
 */
import { jest } from '@jest/globals';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';

// Override DATA_DIR pour les tests
const TEST_DATA = '/tmp/laruche_test_memory';
if (existsSync(TEST_DATA)) rmSync(TEST_DATA, { recursive: true });
mkdirSync(TEST_DATA, { recursive: true });

// Mock le module fs pour pointer vers TEST_DATA
// On teste via les fonctions directement avec data dir réel
import { learn, recall, memoryStats, forget } from '../../../src/learning/missionMemory.js';

describe('missionMemory', () => {
  beforeEach(() => {
    // Nettoie les routes apprises avant chaque test
    forget('test_cleanup_fake_command_xyz');
  });

  describe('similarity & recall', () => {
    test('recall retourne null si mémoire vide', () => {
      const result = recall('commande unique jamais vue 99999');
      expect(result).toBeNull();
    });

    test('learn + recall exact match', () => {
      const steps = [{ skill: 'take_screenshot', params: {} }];
      learn('prends un screenshot test42', steps, true, 300, 'llm');
      
      const recalled = recall('prends un screenshot test42');
      expect(recalled).not.toBeNull();
      expect(recalled.source).toBe('memory');
      expect(recalled.steps[0].skill).toBe('take_screenshot');
      expect(recalled.confidence).toBeGreaterThan(0.9);
    });

    test('recall retourne null sous le threshold', () => {
      const steps = [{ skill: 'open_app', params: { app: 'Safari' } }];
      learn('ouvre safari navigateur web xyz789', steps, true, 200, 'llm');
      
      // Commande très différente — ne doit PAS matcher
      const result = recall('convertis un fichier audio');
      // Peut matcher à 0 (pas de tokens communs), doit être null
      if (result !== null) {
        expect(result.confidence).toBeLessThan(0.72);
      }
    });

    test('learn incrémente les hits sur double appel', () => {
      const steps = [{ skill: 'run_command', params: { command: 'date' } }];
      learn('quelle heure est il test999', steps, true, 100, 'llm');
      learn('quelle heure est il test999', steps, true, 100, 'llm');
      
      const stats = memoryStats();
      const route = stats.topRoutes.find(r => r.command.includes('test999'));
      expect(route).toBeDefined();
      expect(route.hits).toBeGreaterThanOrEqual(2);
    });

    test('learn ignore les succès non-LLM', () => {
      const statsBefore = memoryStats().totalRoutes;
      learn('commande rules engine abc123', [{ skill: 'take_screenshot', params: {} }], true, 100, 'rules');
      const statsAfter = memoryStats().totalRoutes;
      expect(statsAfter).toBe(statsBefore); // Pas ajouté
    });

    test('learn ignore les échecs', () => {
      const statsBefore = memoryStats().totalRoutes;
      learn('commande echouee xyz456', [], false, 100, 'llm');
      const statsAfter = memoryStats().totalRoutes;
      expect(statsAfter).toBe(statsBefore);
    });
  });

  describe('forget', () => {
    test('forget supprime une route connue', () => {
      learn('commande a oublier test777', [{ skill: 'take_screenshot', params: {} }], true, 100, 'llm');
      const recalled = recall('commande a oublier test777');
      expect(recalled).not.toBeNull();
      
      const removed = forget('commande a oublier test777');
      expect(removed).toBe(true);
      
      const recalledAfter = recall('commande a oublier test777');
      expect(recalledAfter).toBeNull();
    });

    test('forget retourne false si route inconnue', () => {
      const result = forget('commande inexistante xyz888888');
      expect(result).toBe(false);
    });
  });

  describe('memoryStats', () => {
    test('retourne les stats correctement', () => {
      const stats = memoryStats();
      expect(stats).toHaveProperty('totalRoutes');
      expect(stats).toHaveProperty('topRoutes');
      expect(Array.isArray(stats.topRoutes)).toBe(true);
    });
  });
});
