/**
 * runtime/modes/ultimate_mode.js
 * Ghost OS Ultimate — Mode Pleine Puissance
 *
 * Active toutes les couches : conscience, perception multimodale,
 * planification hiérarchique, apprentissage continu, exécution parallèle.
 * Équivalent à LaRuche + PICO-RUCHE combinés.
 */

import { UniversalConsciousness } from '../../core/consciousness/universal_consciousness.js';
import { NeuralEventBus }         from '../../core/consciousness/neural_event_bus.js';
import { EpisodicMemorySystem }   from '../../core/consciousness/episodic_memory_system.js';
import { StrategistAgent }        from '../../core/agents/strategist_agent.js';

export class UltimateMode {
  constructor(options = {}) {
    this.name    = 'ultimate';
    this.options = options;

    this.resource_limits = {
      memory:             'unlimited',
      cpu:                'maximum',
      disk:               'high',
      network:            'high',
      parallel_missions:  5,
    };

    this.features = [
      'full_consciousness',
      'multi_modal_perception',
      'strategic_planning',
      'hierarchical_planning',
      'continuous_learning',
      'parallel_execution',
      'advanced_monitoring',
      'skill_factory',
      'swarm_coordination',
      'hitl_telegram',
      'chimera_bus',
    ];

    this._active      = false;
    this.event_bus    = new NeuralEventBus();
    this.memory       = new EpisodicMemorySystem({ max: 10_000 });
    this.strategist   = new StrategistAgent(this.event_bus, this.memory);
    this.consciousness = new UniversalConsciousness({
      event_bus:   this.event_bus,
      memory:      this.memory,
      queen_url:   options.queen_url || 'http://localhost:8001',
      node_url:    options.node_url  || 'http://localhost:3000',
    });
  }

  async activate() {
    if (this._active) {
      console.log('[UltimateMode] Déjà actif');
      return;
    }

    console.log('🚀 Ghost OS Ultimate — Mode ULTIME en cours d\'activation...');

    // Enregistrement des listeners de monitoring
    this._registerListeners();

    // Démarrage de la conscience (async, non-bloquant)
    this.consciousness.achieveConsciousness().catch(err =>
      console.error('[UltimateMode] Conscience échouée:', err.message)
    );

    this._active = true;
    console.log('✅ Mode Ultime activé — toutes les couches opérationnelles');

    return {
      mode:     this.name,
      features: this.features,
      limits:   this.resource_limits,
    };
  }

  async deactivate() {
    if (!this._active) return;
    await this.consciousness.shutdown();
    this._active = false;
    console.log('[UltimateMode] Désactivé');
  }

  isActive() { return this._active; }

  getStatus() {
    return {
      active:        this._active,
      mode:          this.name,
      features:      this.features,
      consciousness: this.consciousness.getState(),
      memory:        this.memory.getStats(),
      event_bus:     this.event_bus.getMetrics(),
    };
  }

  _registerListeners() {
    this.event_bus.on('consciousness.heartbeat', async (data) => {
      if (process.env.LOG_LEVEL === 'debug') {
        console.log(`[UltimateMode] Cycle ${data.cycle} — online: ${data.perception?.online}`);
      }
    });

    this.event_bus.on('consciousness.error', async (data) => {
      console.error(`[UltimateMode] Erreur conscience: ${data.error}`);
    });

    this.event_bus.on('strategic.plan.created', async (plan) => {
      console.log(`[UltimateMode] Plan stratégique: ${plan.objectives?.length || 0} objectifs`);
    });
  }
}
