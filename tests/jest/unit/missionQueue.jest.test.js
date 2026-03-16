/**
 * Tests missionQueue.js — Queue FIFO avec concurrence max configurable
 *
 * Tous les tests sont indépendants (chaque test crée sa propre instance MissionQueue).
 */
import { jest } from '@jest/globals';
import { MissionQueue } from '../../../src/missionQueue.js';

describe('MissionQueue', () => {

  // ── Concurrence max ───────────────────────────────────────────────────────────
  test('respecte la concurrence max (2)', async () => {
    const queue = new MissionQueue(2);
    let running = 0;
    let maxRunning = 0;

    const makeTask = () => async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise(r => setTimeout(r, 50));
      running--;
    };

    await Promise.all([1, 2, 3, 4].map(() => queue.enqueue(makeTask())));
    expect(maxRunning).toBeLessThanOrEqual(2);
  });

  test('respecte la concurrence max (1) — exécution séquentielle', async () => {
    const queue = new MissionQueue(1);
    const order = [];

    const makeTask = (id) => async () => {
      order.push(`start-${id}`);
      await new Promise(r => setTimeout(r, 20));
      order.push(`end-${id}`);
    };

    await Promise.all([1, 2, 3].map(id => queue.enqueue(makeTask(id))));

    // Avec max=1, chaque tâche doit finir avant que la suivante commence
    for (let i = 0; i < order.length - 1; i += 2) {
      const taskId = order[i].split('-')[1];
      expect(order[i]).toBe(`start-${taskId}`);
      expect(order[i + 1]).toBe(`end-${taskId}`);
    }
  });

  // ── Stats ─────────────────────────────────────────────────────────────────────
  test('retourne les stats correctes après exécution', async () => {
    const queue = new MissionQueue(2);

    await Promise.all([
      queue.enqueue(async () => 'ok1'),
      queue.enqueue(async () => 'ok2'),
      queue.enqueue(async () => 'ok3'),
    ]);

    // Attendre un microtask supplémentaire : le .finally() qui décrémente running
    // s'exécute après que la Promise principale ait résolu.
    await new Promise(r => setImmediate(r));

    const stats = queue.stats;
    expect(stats.completed).toBe(3);
    expect(stats.failed).toBe(0);
    expect(stats.running).toBe(0);
    expect(stats.pending).toBe(0);
    expect(stats.maxConcurrent).toBe(2);
  });

  test('stats.failed incremente si la tâche lance une exception', async () => {
    const queue = new MissionQueue(2);

    const results = await Promise.allSettled([
      queue.enqueue(async () => { throw new Error('tâche échouée'); }),
      queue.enqueue(async () => 'ok'),
    ]);

    expect(queue.stats.failed).toBe(1);
    expect(queue.stats.completed).toBe(1);
    // La promise rejetée doit propager l'erreur
    expect(results[0].status).toBe('rejected');
    expect(results[1].status).toBe('fulfilled');
  });

  test('stats initiaux sont tous à 0', () => {
    const queue = new MissionQueue(3);
    const stats = queue.stats;
    expect(stats.pending).toBe(0);
    expect(stats.running).toBe(0);
    expect(stats.completed).toBe(0);
    expect(stats.failed).toBe(0);
    expect(stats.maxConcurrent).toBe(3);
  });

  // ── Saturation queue ──────────────────────────────────────────────────────────
  test('rejette avec statusCode 503 si pending >= 100', async () => {
    const queue = new MissionQueue(1);

    // Bloque le slot unique avec une tâche longue
    const blocker = queue.enqueue(() => new Promise(r => setTimeout(r, 5000)));

    // Remplit la queue jusqu'à saturation (100 pending)
    const fillers = [];
    for (let i = 0; i < 100; i++) {
      fillers.push(queue.enqueue(() => new Promise(r => setTimeout(r, 5000))));
    }

    // La 101ème doit être rejetée immédiatement
    await expect(
      queue.enqueue(() => Promise.resolve('overflow'))
    ).rejects.toMatchObject({ statusCode: 503 });

    // Nettoyage : on n'attend pas les fillers/blocker (test terminé)
    blocker.catch(() => {});
    fillers.forEach(p => p.catch(() => {}));
  });

  // ── Callback onUpdate ─────────────────────────────────────────────────────────
  test('appelle onUpdate à chaque changement d\'état', async () => {
    const queue = new MissionQueue(2);
    const calls = [];

    queue.onUpdate((stats) => {
      calls.push({ ...stats });
    });

    await Promise.all([
      queue.enqueue(async () => { await new Promise(r => setTimeout(r, 20)); }),
      queue.enqueue(async () => { await new Promise(r => setTimeout(r, 20)); }),
    ]);

    // Attendre un microtask supplémentaire pour que le .finally() ait le temps de se déclencher
    await new Promise(r => setImmediate(r));

    // onUpdate doit avoir été appelé au moins lors de l'enqueue et de la fin
    expect(calls.length).toBeGreaterThan(0);
    // Le dernier état doit montrer 0 running et les 2 complétées
    const last = calls[calls.length - 1];
    expect(last.running).toBe(0);
    expect(last.completed).toBe(2);
  });

  test('onUpdate reçoit un objet stats complet', async () => {
    const queue = new MissionQueue(1);
    let lastStats = null;

    queue.onUpdate((stats) => { lastStats = stats; });

    await queue.enqueue(async () => 'done');

    expect(lastStats).toHaveProperty('pending');
    expect(lastStats).toHaveProperty('running');
    expect(lastStats).toHaveProperty('completed');
    expect(lastStats).toHaveProperty('failed');
    expect(lastStats).toHaveProperty('maxConcurrent');
  });

  // ── Valeurs de retour ─────────────────────────────────────────────────────────
  test('enqueue retourne la valeur de la tâche', async () => {
    const queue = new MissionQueue(1);
    const result = await queue.enqueue(async () => ({ id: 'mission-42', status: 'done' }));
    expect(result).toEqual({ id: 'mission-42', status: 'done' });
  });

  // ── Getters pending/running ───────────────────────────────────────────────────
  test('pending getter reflète la queue en attente', async () => {
    const queue = new MissionQueue(1);

    // Lance une tâche bloquante pour occuper le slot
    const slow = queue.enqueue(() => new Promise(r => setTimeout(r, 200)));

    // Ajoute 2 autres (seront en attente)
    const p1 = queue.enqueue(() => Promise.resolve('a'));
    const p2 = queue.enqueue(() => Promise.resolve('b'));

    // À cet instant, 2 sont en pending
    expect(queue.pending).toBeGreaterThanOrEqual(1);

    await Promise.all([slow, p1, p2]);
    expect(queue.pending).toBe(0);
  });
});
