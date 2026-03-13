/**
 * axCache.js — Cache AX Tree différentiel avec TTL par application
 *
 * Évite de re-interroger l'AX tree si rien n'a changé (hash SHA-256).
 * TTL adapté à la vélocité de chaque app : Terminal rafraîchit vite,
 * Finder est lent → moins de polling inutile.
 */

import { createHash } from 'crypto';

// TTL en ms par application — ajustés à la vitesse de changement UI typique
const DEFAULT_TTL = {
  Safari: 500,
  Finder: 2000,
  Terminal: 200,
  Chrome: 500,
  'Google Chrome': 500,
  Xcode: 1000,
  VSCode: 300,
  _default: 1000,
};

export class AXCache {
  constructor() {
    // Map appName → { hash, tree, ts }
    this._store = new Map();
    this._stats = { hits: 0, misses: 0, totalLatencyMs: 0, calls: 0 };
    this._eventCount = 0;
  }

  /**
   * Retourne l'entrée en cache pour une app si elle est encore fraîche.
   * @param {string} appName
   * @returns {object|null}
   */
  get(appName) {
    const entry = this._store.get(appName);
    const ttl = DEFAULT_TTL[appName] ?? DEFAULT_TTL._default;
    if (!entry) return null;
    if (Date.now() - entry.ts > ttl) {
      // Entrée expirée — on l'évince
      this._store.delete(appName);
      return null;
    }
    this._stats.hits++;
    return entry.tree;
  }

  /**
   * Stocke un arbre en cache.
   * Calcule le hash SHA-256 pour détecter les changements.
   * @param {string} appName
   * @param {object} tree
   * @returns {boolean} true si l'arbre a changé, false s'il est identique
   */
  set(appName, tree) {
    const json = JSON.stringify(tree);
    const hash = createHash('sha256').update(json).digest('hex');
    const existing = this._store.get(appName);

    if (existing?.hash === hash) {
      // Arbre identique — pas de mise à jour, compte comme hit
      this._stats.hits++;
      return false; // unchanged
    }

    this._store.set(appName, { hash, tree, ts: Date.now() });
    this._stats.misses++;
    return true; // changed
  }

  /**
   * Invalide le cache pour une app spécifique (ex: changement de focus).
   * @param {string} appName
   */
  invalidate(appName) {
    this._store.delete(appName);
  }

  /** Vide tout le cache (ex: au démarrage ou lors d'un reset). */
  invalidateAll() {
    this._store.clear();
  }

  /**
   * Enregistre la latence d'un appel AX tree réel pour les statistiques.
   * @param {number} ms
   */
  recordLatency(ms) {
    this._stats.totalLatencyMs += ms;
    this._stats.calls++;
  }

  /** Statistiques d'utilisation du cache. */
  get stats() {
    return {
      cacheHits: this._stats.hits,
      cacheMisses: this._stats.misses,
      avgLatencyMs: this._stats.calls > 0
        ? Math.round(this._stats.totalLatencyMs / this._stats.calls)
        : 0,
      eventsReceived: this._eventCount,
      cachedApps: this._store.size,
    };
  }
}

// Singleton partagé à l'échelle du processus
export const axCache = new AXCache();
export { DEFAULT_TTL };
