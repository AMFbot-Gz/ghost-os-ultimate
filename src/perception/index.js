/**
 * perception/index.js — Point d'entrée du module perception
 *
 * Exporte le cache AX, le watcher, et une fonction utilitaire
 * pour obtenir les éléments d'écran avec cache transparent.
 */

export { axCache } from './axCache.js';
export { axWatcher } from './axWatcher.js';

/**
 * Retourne les éléments d'écran en utilisant le cache AX si disponible.
 * Appelle getFreshFn() seulement si le cache est expiré ou absent.
 *
 * @param {Function} getFreshFn  — fonction async qui retourne un arbre AX frais
 * @param {string}   appName     — nom de l'app pour le cache TTL
 * @returns {Promise<object>}    — données AX (avec _fromCache: true si depuis le cache)
 */
export async function getScreenElementsCached(getFreshFn, appName = 'unknown') {
  const { axCache } = await import('./axCache.js');

  const cached = axCache.get(appName);
  if (cached) return { ...cached, _fromCache: true };

  const t = Date.now();
  const fresh = await getFreshFn();
  axCache.recordLatency(Date.now() - t);
  axCache.set(appName, fresh);
  return fresh;
}
