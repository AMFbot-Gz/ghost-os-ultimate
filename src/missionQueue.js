/**
 * src/missionQueue.js — Queue FIFO avec concurrence max configurable
 *
 * Utilisée par queen_oss.js pour limiter le nombre de missions exécutées en parallèle.
 * La concurrence maximale est définie via l'env QUEEN_MAX_PARALLEL (défaut : 3).
 *
 * Contraintes :
 *  - Max 100 missions en attente → rejet HTTP 503 sinon
 *  - Pas de dépendances externes (uniquement des Promises)
 *  - Stats exposables via GET /api/queue
 */

const MAX_QUEUE_SIZE = 100;

export class MissionQueue {
  /**
   * @param {number} maxConcurrent - Nombre max de missions en parallèle
   */
  constructor(maxConcurrent = 3) {
    this._maxConcurrent = maxConcurrent;

    /** @type {Array<{ fn: Function, resolve: Function, reject: Function }>} */
    this._queue = [];   // missions en attente (FIFO)

    this._running = 0;  // nb de missions actuellement en cours
    this._completed = 0;
    this._failed = 0;

    // Callback optionnel pour notifier les changements d'état (pending/running)
    this._onChange = null;
  }

  /**
   * Définit un callback appelé à chaque changement de pending/running.
   * Utilisé par queen_oss.js pour broadcastHUD({ type: "queue_update" }).
   * @param {Function} fn
   */
  onUpdate(fn) {
    this._onChange = fn;
  }

  /**
   * Ajoute une fonction asynchrone en queue.
   * Retourne une Promise qui résout/rejette quand la mission se termine.
   *
   * @param {() => Promise<any>} fn - Fonction à exécuter (ex: () => runMission(...))
   * @returns {Promise<any>}
   * @throws {Error} avec code 503 si la queue est saturée (> MAX_QUEUE_SIZE)
   */
  enqueue(fn) {
    if (this._queue.length >= MAX_QUEUE_SIZE) {
      const err = new Error(`Queue saturée : ${MAX_QUEUE_SIZE} missions en attente (limite atteinte)`);
      err.statusCode = 503;
      return Promise.reject(err);
    }

    return new Promise((resolve, reject) => {
      this._queue.push({ fn, resolve, reject });
      this._notify();
      this._drain();
    });
  }

  /**
   * Démarre les prochaines missions si des slots sont disponibles.
   * Appelé après chaque enqueue() et après chaque fin de mission.
   * @private
   */
  _drain() {
    while (this._running < this._maxConcurrent && this._queue.length > 0) {
      const { fn, resolve, reject } = this._queue.shift();
      this._running++;
      this._notify();

      // Exécution de la mission dans un microtask pour ne pas bloquer l'event loop
      Promise.resolve()
        .then(() => fn())
        .then((result) => {
          this._completed++;
          resolve(result);
        })
        .catch((err) => {
          this._failed++;
          reject(err);
        })
        .finally(() => {
          this._running--;
          this._notify();
          // Tente de démarrer une mission suivante en attente
          this._drain();
        });
    }
  }

  /**
   * Notifie le callback d'update si défini.
   * @private
   */
  _notify() {
    if (typeof this._onChange === 'function') {
      try {
        this._onChange(this.stats);
      } catch {}
    }
  }

  /** Nombre de missions en attente dans la queue */
  get pending() {
    return this._queue.length;
  }

  /** Nombre de missions en cours d'exécution */
  get running() {
    return this._running;
  }

  /** Statistiques complètes de la queue */
  get stats() {
    return {
      pending: this._queue.length,
      running: this._running,
      completed: this._completed,
      failed: this._failed,
      maxConcurrent: this._maxConcurrent,
    };
  }
}

// ─── Instance singleton exportée ──────────────────────────────────────────────
// Concurrence configurable via QUEEN_MAX_PARALLEL (défaut : 3)
export const missionQueue = new MissionQueue(
  parseInt(process.env.QUEEN_MAX_PARALLEL || "3", 10)
);
