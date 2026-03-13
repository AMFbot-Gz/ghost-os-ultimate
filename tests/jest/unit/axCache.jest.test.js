/**
 * Tests axCache — Cache AX Tree différentiel
 *
 * Couvre : set, get, expiration TTL, hash inchangé, statistiques.
 * Utilise la classe AXCache directement (pas le singleton) pour l'isolation.
 */

import { AXCache, DEFAULT_TTL } from '../../src/perception/axCache.js';

describe('AXCache', () => {
  let cache;

  beforeEach(() => {
    // Nouvelle instance isolée pour chaque test
    cache = new AXCache();
  });

  test('set stocke un arbre et get le retourne avant expiration', () => {
    const tree = { elements: [{ role: 'button', title: 'OK' }] };
    cache.set('Safari', tree);

    const result = cache.get('Safari');
    expect(result).not.toBeNull();
    expect(result).toEqual(tree);
  });

  test('get retourne null pour une app jamais mise en cache', () => {
    expect(cache.get('AppInconnue')).toBeNull();
  });

  test('expiration TTL — get retourne null après le TTL', () => {
    // Injecte une entrée avec un timestamp volontairement vieux
    const tree = { elements: [] };
    cache.set('Terminal', tree);

    // Forge un timestamp expiré : TTL Terminal = 200ms → ajoute 1000ms de délai
    const entry = cache._store.get('Terminal');
    entry.ts = Date.now() - (DEFAULT_TTL.Terminal + 1000);

    expect(cache.get('Terminal')).toBeNull();
    // L'entrée doit avoir été évincée
    expect(cache._store.has('Terminal')).toBe(false);
  });

  test('set retourne false (unchanged) si le contenu est identique', () => {
    const tree = { elements: [{ role: 'textField', title: 'URL' }] };
    cache.set('Chrome', tree);

    // Même arbre → hash identique → pas de mise à jour
    const changed = cache.set('Chrome', tree);
    expect(changed).toBe(false);
  });

  test('set retourne true (changed) si le contenu a changé', () => {
    const treeV1 = { elements: [{ role: 'button', title: 'Fermer' }] };
    const treeV2 = { elements: [{ role: 'button', title: 'Fermer' }, { role: 'textField', title: 'Titre' }] };

    cache.set('Finder', treeV1);
    const changed = cache.set('Finder', treeV2);
    expect(changed).toBe(true);

    // Le cache doit contenir la nouvelle version
    expect(cache.get('Finder')).toEqual(treeV2);
  });

  test('stats reflètent les hits, misses et latence', () => {
    const tree = { x: 1 };

    // Première mise en cache → miss
    cache.set('VSCode', tree);
    // get avant expiration → hit
    cache.get('VSCode');
    // set avec même contenu → hit (unchanged)
    cache.set('VSCode', tree);
    // recordLatency
    cache.recordLatency(100);
    cache.recordLatency(200);

    const stats = cache.stats;
    expect(stats.cacheMisses).toBeGreaterThanOrEqual(1);
    expect(stats.cacheHits).toBeGreaterThanOrEqual(2);
    expect(stats.avgLatencyMs).toBe(150); // (100 + 200) / 2
    expect(stats.cachedApps).toBe(1);
  });

  test('invalidate supprime une entrée du cache', () => {
    cache.set('Xcode', { elements: [] });
    expect(cache.get('Xcode')).not.toBeNull();

    cache.invalidate('Xcode');
    expect(cache.get('Xcode')).toBeNull();
  });

  test('invalidateAll vide tout le cache', () => {
    cache.set('Safari', { a: 1 });
    cache.set('Terminal', { b: 2 });
    cache.invalidateAll();

    expect(cache.stats.cachedApps).toBe(0);
  });
});
