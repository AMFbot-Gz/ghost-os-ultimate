/**
 * core/events/event_bus.js — Bus d'événements central Ghost OS Ultimate
 *
 * ARCHITECTURE (tâche #13) :
 *   Ce module exporte désormais un singleton de NeuralEventBus comme bus unique
 *   partagé entre la Queen Node.js (queen_oss.js) et le mode Ultime
 *   (runtime/modes/ultimate_mode.js). Cela garantit que la conscience universelle
 *   reçoit bien tous les événements émis par la Queen.
 *
 *   Compatibilité ascendante assurée : les appels .emit(), .on(), .off() existants
 *   dans queen_oss.js continuent de fonctionner sans modification.
 *
 *   L'ancienne classe EventBus (wrapper EventEmitter) est conservée pour référence
 *   mais n'est plus instanciée comme singleton principal.
 */

import { EventEmitter } from 'events';
import { NeuralEventBus } from '../consciousness/neural_event_bus.js';

// ─── Ancienne classe EventBus (conservée pour compatibilité de type) ──────────

export class EventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(50);
    this._middleware = [];
    this.metrics = { emitted: 0, processed: 0, failed: 0 };
  }

  use(fn) {
    this._middleware.push(fn);
    return this;
  }

  async emit(event, payload = {}) {
    this.metrics.emitted++;
    try {
      let data = payload;
      for (const mw of this._middleware) {
        data = await mw(event, data) ?? data;
      }
      super.emit(event, data);
      const listeners = this.listeners(event);
      await Promise.all(
        listeners.map(fn =>
          Promise.resolve(fn(data)).catch(err =>
            console.error(`[EventBus] listener error on "${event}":`, err.message)
          )
        )
      );
      this.metrics.processed++;
    } catch (err) {
      this.metrics.failed++;
      console.error(`[EventBus] emit error on "${event}":`, err.message);
    }
  }

  on(event, listener) {
    super.on(event, listener);
    return this;
  }

  off(event, listener) {
    super.off(event, listener);
    return this;
  }

  getMetrics() {
    return { ...this.metrics, listeners: this.eventNames().length };
  }
}

// ─── Singleton partagé ────────────────────────────────────────────────────────
//
// On utilise directement une instance de NeuralEventBus comme singleton unique.
// NeuralEventBus expose la même API que EventBus (.emit, .on, .off, .use,
// .getMetrics) donc queen_oss.js n'a pas besoin d'être modifié.
//
// UltimateMode importe ce même singleton au lieu de créer sa propre instance,
// ce qui relie la conscience universelle aux événements de la Queen.

export const eventBus = new NeuralEventBus();
export default eventBus;
