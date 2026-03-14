/**
 * core/consciousness/universal_consciousness.js
 * Ghost OS Ultimate — Couche de conscience universelle
 *
 * Orchestre les 5 états de conscience :
 *   1. Auto-perception  (self_awareness)
 *   2. Perception env   (environmental_awareness)
 *   3. Conscience buts  (goal_awareness)
 *   4. Intégration multimodale
 *   5. Boucle continue  (consciousness loop)
 */

import { NeuralEventBus } from './neural_event_bus.js';
import { EpisodicMemorySystem } from './episodic_memory_system.js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// Racine du projet (deux niveaux au-dessus de core/consciousness/)
const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '../../');

// ─── Constantes ───────────────────────────────────────────────────────────────
const LOOP_INTERVAL_MS = 30_000;   // 30s — sync avec vital_loop PICO-RUCHE
const MAX_CONSECUTIVE_ERRORS = 5;

// ─── UniversalConsciousness ───────────────────────────────────────────────────
export class UniversalConsciousness {
  constructor(options = {}) {
    this.event_bus    = options.event_bus    || new NeuralEventBus();
    this.memory       = options.memory       || new EpisodicMemorySystem();
    this.agent_queen_url = options.queen_url || 'http://localhost:8001';
    this.node_queen_url  = options.node_url  || 'http://localhost:3000';

    this.state = {
      self_awareness:           false,
      environmental_awareness:  false,
      goal_awareness:           false,
      learning_mode:            'continuous',  // 'continuous' | 'paused' | 'offline'
      last_perception:          null,
      active_goals:             [],
      cycle:                    0,
      errors:                   0,
    };

    this._loop_handle = null;
    this._running     = false;

    // Tâches périodiques issues de HEARTBEAT.md
    this._heartbeat_tasks = this._loadHeartbeat();
  }

  // ─── Point d'entrée public ────────────────────────────────────────────────

  async achieveConsciousness() {
    if (this._running) return;
    this._running = true;

    try {
      await this._establishSelfAwareness();
      await this._establishEnvironmentalAwareness();
      await this._establishGoalAwareness();
      await this._integrateModalities();
      this._startConsciousnessLoop();
    } catch (err) {
      console.error('[Consciousness] Démarrage échoué:', err.message);
      this._running = false;
    }
  }

  async shutdown() {
    this._running = false;
    this.state.learning_mode = 'paused';
    if (this._loop_handle) clearTimeout(this._loop_handle);
    await this.event_bus.emit('consciousness.shutdown', { cycle: this.state.cycle });
  }

  getState() {
    return { ...this.state };
  }

  // ─── Étapes d'initialisation ──────────────────────────────────────────────

  async _establishSelfAwareness() {
    const self_model = {
      identity:    'Ghost OS Ultimate v1.0.0',
      runtime:     'Node.js + Python (7 couches)',
      capabilities: await this._listCapabilities(),
      hardware:    this._detectHardware(),
      purpose:     'Agent autonome hybride local — computer-use + planning + learning',
    };

    this.state.self_awareness = true;
    await this.event_bus.emit('self.aware', self_model);
    console.log('[Consciousness] ✅ Auto-perception établie');
  }

  async _establishEnvironmentalAwareness() {
    try {
      const health = await this._fetchJSON(`${this.agent_queen_url}/health`);
      const system = await this._fetchJSON(`${this.node_queen_url}/api/system`);

      const environment = {
        timestamp:   Date.now(),
        layers:      health,
        system:      system,
        online:      true,
      };

      this.state.environmental_awareness = true;
      this.state.last_perception = environment;
      await this.event_bus.emit('environment.perceived', environment);
      console.log('[Consciousness] ✅ Conscience environnementale établie');
    } catch (err) {
      // Mode hors-ligne — la conscience reste fonctionnelle
      this.state.environmental_awareness = true;
      this.state.last_perception = { timestamp: Date.now(), online: false };
      await this.event_bus.emit('environment.perceived', { online: false });
      console.warn('[Consciousness] ⚠️  Mode hors-ligne — perception dégradée');
    }
  }

  async _establishGoalAwareness() {
    // Récupère les goals depuis le WorldModel si disponible
    let goals = [];
    try {
      const data = await this._fetchJSON(`${this.node_queen_url}/api/status`);
      goals = data.active_goals || [];
    } catch {
      goals = [{ id: 'default', description: 'Attendre des missions', priority: 1 }];
    }

    this.state.active_goals  = goals;
    this.state.goal_awareness = true;
    await this.event_bus.emit('goals.established', goals);
    console.log(`[Consciousness] ✅ ${goals.length} objectif(s) actif(s)`);
  }

  async _integrateModalities() {
    const integration = {
      visual:  await this._probeModality('vision'),
      system:  await this._probeModality('system'),
      memory:  this.memory.size(),
    };

    await this.event_bus.emit('modalities.integrated', integration);
    console.log('[Consciousness] ✅ Intégration multimodale prête');
  }

  // ─── Boucle de conscience ─────────────────────────────────────────────────

  _startConsciousnessLoop() {
    console.log('[Consciousness] 🔄 Boucle de conscience démarrée');
    this._scheduleNextCycle();
  }

  _scheduleNextCycle() {
    if (!this._running || this.state.learning_mode === 'paused') return;
    this._loop_handle = setTimeout(() => this._runCycle(), LOOP_INTERVAL_MS);
  }

  async _runCycle() {
    this.state.cycle++;
    const cycleId = `cycle-${this.state.cycle}`;

    try {
      // 1. Perception
      const perception = await this._perceiveEnvironment();

      // 2. Intégration mémoire
      await this.memory.storeEpisode({
        type:       'perception',
        cycle:      this.state.cycle,
        perception,
        timestamp:  Date.now(),
      });

      // 3. Évaluation des goals
      const goals_status = await this._evaluateGoals(perception);

      // 4. Émission du heartbeat
      await this.event_bus.emit('consciousness.heartbeat', {
        cycle:        this.state.cycle,
        perception,
        goals_status,
        state:        this.getState(),
      });

      // 5. Tâches périodiques HEARTBEAT.md
      await this._runHeartbeatTasks();

      this.state.errors = 0;

    } catch (err) {
      this.state.errors++;
      await this.event_bus.emit('consciousness.error', { cycleId, error: err.message });
      console.error(`[Consciousness] Erreur cycle ${cycleId}:`, err.message);

      if (this.state.errors >= MAX_CONSECUTIVE_ERRORS) {
        console.error('[Consciousness] ❌ Trop d\'erreurs — passage en mode dégradé');
        this.state.learning_mode = 'offline';
      }
    }

    this._scheduleNextCycle();
  }

  // ─── Helpers internes ─────────────────────────────────────────────────────

  async _perceiveEnvironment() {
    try {
      const [health, system] = await Promise.allSettled([
        this._fetchJSON(`${this.agent_queen_url}/health`),
        this._fetchJSON(`${this.node_queen_url}/api/system`),
      ]);

      return {
        timestamp:   Date.now(),
        layers:      health.status === 'fulfilled' ? health.value : null,
        system:      system.status === 'fulfilled' ? system.value : null,
        online:      health.status === 'fulfilled',
      };
    } catch {
      return { timestamp: Date.now(), online: false };
    }
  }

  async _evaluateGoals(perception) {
    const statuses = this.state.active_goals.map(goal => ({
      id:     goal.id,
      active: true,
      progress: perception.online ? 'running' : 'blocked',
    }));
    return statuses;
  }

  async _listCapabilities() {
    try {
      const data = await this._fetchJSON(`${this.node_queen_url}/api/skills`);
      return data.skills?.map(s => s.name) || [];
    } catch {
      return ['computer_use', 'vision', 'shell', 'planning', 'memory', 'telegram'];
    }
  }

  _detectHardware() {
    // Import synchrone — os est un module natif Node.js, toujours disponible
    const { cpus, totalmem, freemem } = (function() {
      try { return require('os'); } catch { return {}; }
    })();
    return {
      platform:    process.platform,
      arch:        process.arch,
      cpu_count:   typeof cpus === 'function' ? cpus().length : 0,
      cpu_model:   typeof cpus === 'function' ? (cpus()[0]?.model || 'unknown') : 'unknown',
      memory_gb:   typeof totalmem === 'function' ? Math.round(totalmem() / 1024 ** 3 * 10) / 10 : 0,
      memory_free_gb: typeof freemem === 'function' ? Math.round(freemem() / 1024 ** 3 * 10) / 10 : 0,
    };
  }

  async _probeModality(name) {
    try {
      await this._fetchJSON(`${this.agent_queen_url}/health`);
      return { available: true, name };
    } catch {
      return { available: false, name };
    }
  }

  // ─── HEARTBEAT — tâches périodiques définies en Markdown ─────────────────

  /**
   * Lit HEARTBEAT.md depuis la racine du projet et retourne un tableau de tâches.
   * Chaque section `## [intervalle] Titre` devient une entrée schedulée.
   * Intervalles supportés : 30s, 5min, 30min, 1h (et leurs variantes).
   *
   * @returns {{ interval_ms: number, title: string, slug: string, description: string, next_run: number }[]}
   */
  _loadHeartbeat() {
    try {
      const heartbeatPath = resolve(PROJECT_ROOT, 'HEARTBEAT.md');
      const content = readFileSync(heartbeatPath, 'utf8');

      // Regex : ## [intervalle] Titre
      const sectionRegex = /^##\s+\[([^\]]+)\]\s+(.+)$/gm;
      const tasks = [];
      let match;

      while ((match = sectionRegex.exec(content)) !== null) {
        const rawInterval = match[1].trim();
        const title       = match[2].trim();
        const slug        = title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/^_|_$/g, '');

        const interval_ms = this._parseInterval(rawInterval);
        if (interval_ms === null) {
          console.warn(`[Heartbeat] Intervalle inconnu ignoré : "${rawInterval}" (tâche : ${title})`);
          continue;
        }

        // Extrait la description : lignes qui suivent le titre jusqu'à la prochaine section ##
        const headerLine = match[0];
        const startIdx   = content.indexOf(headerLine) + headerLine.length;
        const nextMatch  = /^##\s+\[/m.exec(content.slice(startIdx));
        const block      = nextMatch
          ? content.slice(startIdx, startIdx + nextMatch.index)
          : content.slice(startIdx);
        const description = block.trim();

        tasks.push({
          interval_ms,
          title,
          slug,
          description,
          next_run: Date.now() + interval_ms, // Première exécution différée d'un intervalle complet
        });
      }

      console.log(`[Heartbeat] ${tasks.length} tâche(s) chargée(s) depuis HEARTBEAT.md`);
      return tasks;
    } catch (err) {
      console.warn(`[Heartbeat] Impossible de lire HEARTBEAT.md : ${err.message}`);
      return [];
    }
  }

  /**
   * Convertit une chaîne d'intervalle en millisecondes.
   * Exemples : "30s" → 30000, "5min" → 300000, "30min" → 1800000, "1h" → 3600000.
   *
   * @param {string} raw
   * @returns {number|null}
   */
  _parseInterval(raw) {
    const s   = raw.toLowerCase().trim();
    const num = parseFloat(s);
    if (isNaN(num)) return null;

    if (s.endsWith('h'))                        return Math.round(num * 3_600_000);
    if (s.endsWith('min') || s.endsWith('m'))   return Math.round(num * 60_000);
    if (s.endsWith('s'))                        return Math.round(num * 1_000);
    return null;
  }

  /**
   * Parcourt les tâches heartbeat et exécute celles dont `next_run <= Date.now()`.
   * Chaque tâche éligible émet `heartbeat.<slug>` sur le bus d'événements.
   */
  async _runHeartbeatTasks() {
    if (!this._heartbeat_tasks || this._heartbeat_tasks.length === 0) return;

    const now = Date.now();
    for (const task of this._heartbeat_tasks) {
      if (now < task.next_run) continue;

      try {
        await this.event_bus.emit(`heartbeat.${task.slug}`, {
          title:       task.title,
          description: task.description,
          interval_ms: task.interval_ms,
          triggered_at: now,
          cycle:        this.state.cycle,
        });
        console.log(`[Heartbeat] ▶ Tâche exécutée : ${task.title}`);
      } catch (err) {
        console.error(`[Heartbeat] Erreur tâche "${task.title}": ${err.message}`);
      }

      // Planifie la prochaine exécution
      task.next_run = now + task.interval_ms;
    }
  }

  async _fetchJSON(url, opts = {}) {
    const { default: https } = await import('https');
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('timeout')), 5000);
      import('node:http').then(({ default: http }) => {
        const mod = url.startsWith('https') ? https : http;
        mod.get(url, opts, res => {
          clearTimeout(timeout);
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            try { resolve(JSON.parse(data)); }
            catch (e) { reject(e); }
          });
        }).on('error', err => { clearTimeout(timeout); reject(err); });
      });
    });
  }
}
