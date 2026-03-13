/**
 * core/consciousness/neural_event_bus.js
 * Ghost OS Ultimate — Bus d'événements neuronal haute performance
 *
 * Extension de l'EventBus PICO-RUCHE avec :
 *   - Priorités d'écouteurs
 *   - Pipeline middleware
 *   - Métriques d'impulsions
 *   - Gestion d'erreurs par écouteur
 */

export class NeuralEventBus {
  constructor() {
    // Map<event, [{listener, priority}]>
    this._listeners = new Map();
    this._middleware = [];
    this._metrics = {
      impulses:        0,
      total_latency_ms: 0,
      errors:          0,
    };
    this._history = [];           // Derniers 100 événements
    this._MAX_HISTORY = 100;
  }

  // ─── API principale ───────────────────────────────────────────────────────

  /**
   * Émet un événement vers tous les écouteurs en parallèle.
   * Passe par le pipeline middleware avant la distribution.
   */
  async emit(event, payload = {}, options = {}) {
    const start = performance.now();
    this._metrics.impulses++;

    // Pipeline middleware (ex: logging, tracing, auth)
    let processed = payload;
    for (const mw of this._middleware) {
      try {
        processed = await mw(processed, event, options);
      } catch (err) {
        console.error(`[NeuralEventBus] Middleware error on "${event}":`, err.message);
      }
    }

    // Distribution parallèle
    const entries = this._listeners.get(event) || [];
    const promises = entries.map(({ listener }) =>
      Promise.resolve().then(() => listener(processed)).catch(err => {
        this._metrics.errors++;
        console.error(`[NeuralEventBus] Listener error on "${event}":`, err.message);
      })
    );
    await Promise.all(promises);

    // Métriques
    const latency = performance.now() - start;
    this._metrics.total_latency_ms += latency;

    // Historique
    this._history.push({ event, timestamp: Date.now(), latency_ms: latency });
    if (this._history.length > this._MAX_HISTORY) this._history.shift();
  }

  /**
   * Abonne un écouteur à un événement.
   * @param {string} event
   * @param {Function} listener
   * @param {number} priority - Plus élevé = appelé en premier (tri décroissant)
   */
  on(event, listener, priority = 0) {
    if (!this._listeners.has(event)) this._listeners.set(event, []);
    const arr = this._listeners.get(event);
    arr.push({ listener, priority });
    arr.sort((a, b) => b.priority - a.priority);
    return () => this.off(event, listener);  // Retourne un unsubscribe
  }

  /** Désabonne un écouteur. */
  off(event, listener) {
    if (!this._listeners.has(event)) return;
    const arr = this._listeners.get(event).filter(e => e.listener !== listener);
    this._listeners.set(event, arr);
  }

  /** Abonnement one-shot (auto-désabonnement après premier appel). */
  once(event, listener) {
    const wrapped = async (payload) => {
      this.off(event, wrapped);
      await listener(payload);
    };
    this.on(event, wrapped);
  }

  /** Ajoute un middleware au pipeline. */
  use(middleware) {
    this._middleware.push(middleware);
  }

  // ─── Métriques & debug ────────────────────────────────────────────────────

  getMetrics() {
    const avg_latency = this._metrics.impulses > 0
      ? this._metrics.total_latency_ms / this._metrics.impulses
      : 0;

    return {
      ...this._metrics,
      avg_latency_ms:    Math.round(avg_latency * 100) / 100,
      registered_events: this._listeners.size,
      total_listeners:   Array.from(this._listeners.values()).reduce((s, a) => s + a.length, 0),
    };
  }

  getRecentEvents(n = 20) {
    return this._history.slice(-n);
  }

  listEvents() {
    return Array.from(this._listeners.keys());
  }

  reset() {
    this._listeners.clear();
    this._middleware.length = 0;
    this._metrics = { impulses: 0, total_latency_ms: 0, errors: 0 };
    this._history.length = 0;
  }
}
