/**
 * src/pico-satellite-daemon.js — Daemon PM2 pour le satellite PicoClaw
 *
 * Ce script est le point d'entrée PM2 (process 15 dans ecosystem.config.cjs).
 * Il initialise pico-satellite.js, maintient la connexion, et redémarre
 * automatiquement si le binaire disparaît.
 */

import { init, isAvailable } from './pico-satellite.js';

const CHECK_INTERVAL = 60_000; // Vérification toutes les 60s

async function main() {
  console.log('[pico-satellite-daemon] Démarrage...');

  const ready = await init();
  if (!ready) {
    console.warn('[pico-satellite-daemon] Satellite non disponible au démarrage — mode surveillance');
  } else {
    console.log('[pico-satellite-daemon] Satellite opérationnel');
  }

  // Boucle de surveillance — tente de relancer si perdu
  setInterval(async () => {
    const alive = await isAvailable();
    if (!alive) {
      console.warn('[pico-satellite-daemon] Satellite perdu — tentative de relance...');
      await init().catch(e => console.warn('[pico-satellite-daemon] Relance échouée:', e.message));
    }
  }, CHECK_INTERVAL);
}

main().catch(e => {
  console.error('[pico-satellite-daemon] Erreur fatale:', e.message);
  process.exit(1);
});
