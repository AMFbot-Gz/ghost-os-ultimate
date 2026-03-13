/**
 * axWatcher.js — Watcher d'événements AX via polling léger
 *
 * osascript ne supporte pas les NSNotifications en Node.js, donc on utilise
 * un polling léger toutes les 250ms pour détecter les changements de focus.
 * Quand l'app de premier plan change, on invalide le cache de l'ancienne app
 * et on émet un événement 'app_change'.
 */

import { execa } from 'execa';
import { axCache } from './axCache.js';
import { EventEmitter } from 'events';

export class AXWatcher extends EventEmitter {
  /**
   * @param {number} pollIntervalMs — fréquence de polling en ms (défaut: 250ms)
   */
  constructor(pollIntervalMs = 250) {
    super();
    this._interval = null;
    this._pollMs = pollIntervalMs;
    this._lastApp = null;
    this._eventCount = 0;
  }

  /** Démarre le polling. Idempotent — sans effet si déjà démarré. */
  start() {
    if (this._interval) return;
    this._interval = setInterval(() => this._poll(), this._pollMs);
    // unref() pour ne pas empêcher Node de quitter si c'est le seul timer actif
    this._interval.unref();
  }

  /** Stoppe le polling. */
  stop() {
    clearInterval(this._interval);
    this._interval = null;
  }

  /** Interroge macOS pour l'application au premier plan. */
  async _poll() {
    try {
      const { stdout } = await execa('osascript', [
        '-e',
        'tell application "System Events" to get name of first process whose frontmost is true',
      ], { timeout: 500, reject: false });

      const app = stdout?.trim();
      if (app && app !== this._lastApp) {
        // L'app au premier plan a changé → invalide le cache de l'ancienne
        if (this._lastApp) axCache.invalidate(this._lastApp);

        this._lastApp = app;
        this._eventCount++;
        // Partage le compteur d'événements avec le cache pour les stats
        axCache._eventCount = this._eventCount;

        this.emit('app_change', {
          app,
          reason: 'focus_change',
          timestamp: new Date().toISOString(),
        });
      }
    } catch {
      // Silencieux — osascript peut échouer temporairement
    }
  }
}

// Singleton partagé
export const axWatcher = new AXWatcher();
