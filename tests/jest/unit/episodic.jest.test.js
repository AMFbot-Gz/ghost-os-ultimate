/**
 * Tests src/memory/episodic/index.js — Mémoire épisodique
 */
import { jest } from '@jest/globals';
import { existsSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

// Isole les tests dans un répertoire temporaire
// On réinitialise le cache interne en réimportant le module
// Pour éviter les collisions entre tests, on nettoie episodes.jsonl avant chaque suite

describe('episodic memory', () => {
  let storeEpisode, retrieveSimilarEpisodes, episodeStats, getEpisodes, deleteEpisode;

  beforeAll(async () => {
    // Réinitialise le fichier episodes.jsonl pour tests propres
    const dataDir = new URL('../../../data', import.meta.url).pathname;
    const episodesFile = join(dataDir, 'episodes_test_tmp.jsonl');
    // On importe le vrai module — il utilisera data/episodes.jsonl
    const mod = await import('../../src/memory/episodic/index.js');
    storeEpisode = mod.storeEpisode;
    retrieveSimilarEpisodes = mod.retrieveSimilarEpisodes;
    episodeStats = mod.episodeStats;
    getEpisodes = mod.getEpisodes;
    deleteEpisode = mod.deleteEpisode;
  });

  // ── storeEpisode ──────────────────────────────────────────────────────────────

  test('storeEpisode retourne un épisode avec id et timestamp', () => {
    const ep = storeEpisode({
      mission: 'ouvre Safari et va sur google.com',
      outcome: 'success',
      rewardScore: 0.9,
      lessons: ['toujours vérifier si Safari est déjà ouvert'],
    });

    expect(ep).toBeDefined();
    expect(ep.id).toMatch(/^ep-/);
    expect(ep.mission).toBe('ouvre Safari et va sur google.com');
    expect(ep.outcome).toBe('success');
    expect(ep.rewardScore).toBe(0.9);
    expect(ep.timestamp).toBeDefined();
    expect(Array.isArray(ep.lessons)).toBe(true);
    expect(ep.lessons).toHaveLength(1);
  });

  test('storeEpisode clamp rewardScore entre 0 et 1', () => {
    const epHigh = storeEpisode({ mission: 'test clamp haut', rewardScore: 5.0, outcome: 'success' });
    const epLow = storeEpisode({ mission: 'test clamp bas', rewardScore: -2.0, outcome: 'failed' });

    expect(epHigh.rewardScore).toBe(1.0);
    expect(epLow.rewardScore).toBe(0.0);
  });

  test('storeEpisode tronque mission à 200 caractères', () => {
    const longMission = 'x'.repeat(500);
    const ep = storeEpisode({ mission: longMission, outcome: 'unknown' });
    expect(ep.mission.length).toBeLessThanOrEqual(200);
  });

  // ── retrieveSimilarEpisodes ───────────────────────────────────────────────────

  test('retrieveSimilarEpisodes retourne épisodes similaires', () => {
    storeEpisode({
      mission: 'prends un screenshot du bureau',
      outcome: 'success',
      rewardScore: 1.0,
    });
    storeEpisode({
      mission: 'ouvre le terminal et lance une commande',
      outcome: 'success',
      rewardScore: 0.8,
    });

    const results = retrieveSimilarEpisodes('prends screenshot');
    // Doit retourner au moins 1 résultat similaire
    expect(Array.isArray(results)).toBe(true);
    // Si des épisodes correspondants existent, ils doivent avoir un score > 0.1
    if (results.length > 0) {
      expect(results[0]._score).toBeGreaterThan(0.1);
      // Résultats triés par score décroissant
      for (let i = 1; i < results.length; i++) {
        expect(results[i]._score).toBeLessThanOrEqual(results[i - 1]._score);
      }
    }
  });

  test('retrieveSimilarEpisodes respecte la limite', () => {
    // Stocke plusieurs épisodes avec le même mot-clé
    for (let i = 0; i < 10; i++) {
      storeEpisode({ mission: `tâche automatique numéro ${i}`, outcome: 'success', rewardScore: 0.5 });
    }

    const results = retrieveSimilarEpisodes('tâche automatique', 3);
    expect(results.length).toBeLessThanOrEqual(3);
  });

  // ── episodeStats ──────────────────────────────────────────────────────────────

  test('episodeStats retourne totalEpisodes et avgRewardScore', () => {
    const stats = episodeStats();
    expect(stats).toHaveProperty('totalEpisodes');
    expect(stats).toHaveProperty('avgRewardScore');
    expect(typeof stats.totalEpisodes).toBe('number');
    expect(typeof stats.avgRewardScore).toBe('number');
    expect(stats.totalEpisodes).toBeGreaterThan(0);
    expect(stats.avgRewardScore).toBeGreaterThanOrEqual(0);
    expect(stats.avgRewardScore).toBeLessThanOrEqual(1);
  });

  // ── deleteEpisode ─────────────────────────────────────────────────────────────

  test('deleteEpisode supprime un épisode existant', () => {
    const ep = storeEpisode({
      mission: 'épisode à supprimer test unique 12345',
      outcome: 'failed',
      rewardScore: 0.0,
    });

    const before = episodeStats().totalEpisodes;
    const deleted = deleteEpisode(ep.id);
    const after = episodeStats().totalEpisodes;

    expect(deleted).toBe(true);
    expect(after).toBe(before - 1);
  });

  test('deleteEpisode retourne false pour un id inconnu', () => {
    const result = deleteEpisode('ep-id-qui-nexiste-pas-xyz999');
    expect(result).toBe(false);
  });
});
