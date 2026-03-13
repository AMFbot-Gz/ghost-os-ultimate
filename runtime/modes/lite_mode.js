/**
 * runtime/modes/lite_mode.js
 * Ghost OS Ultimate — Mode Léger (PICO-RUCHE standalone)
 *
 * Optimisé pour les machines avec ressources limitées.
 * Désactive : swarm, perception audio, planification hiérarchique complète.
 * Garde : vision, exécution, mémoire, Telegram HITL.
 */

export class LiteMode {
  constructor(options = {}) {
    this.name    = 'lite';
    this.options = options;

    this.resource_limits = {
      memory:             '500MB',
      cpu:                '2 cores',
      disk:               '1GB',
      network:            'low',
      parallel_missions:  1,
    };

    this.features = [
      'basic_consciousness',
      'visual_perception',
      'simple_planning',
      'sequential_execution',
      'memory_basic',
      'hitl_telegram',
    ];

    this._active = false;
  }

  async activate() {
    if (this._active) return;

    console.log('🕹️ Ghost OS Ultimate — Mode LÉGER en cours d\'activation...');

    // Limite les ressources Python
    process.env.PYTHON_MAX_WORKERS = '1';
    process.env.LITE_MODE          = 'true';
    process.env.DISABLE_SWARM      = 'true';

    this._active = true;
    console.log('✅ Mode Léger activé — ressources optimisées');

    return {
      mode:     this.name,
      features: this.features,
      limits:   this.resource_limits,
    };
  }

  async deactivate() {
    this._active = false;
  }

  isActive()  { return this._active; }
  getStatus() { return { active: this._active, mode: this.name, features: this.features }; }
}
