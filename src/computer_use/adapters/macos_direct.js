/**
 * src/computer_use/adapters/macos_direct.js — MacOsDirectAdapter
 *
 * Implémentation de ComputerUseAdapter pour la machine locale (macOS).
 * Wraps les skills existants de Ghost OS — ZÉRO disruption du comportement actuel.
 *
 * Ce fichier est le "shim" de migration : le cœur appelle maintenant
 * adapter.act() au lieu d'appeler le skill directement, mais le résultat
 * est identique. Quand on voudra passer à un daemon distant, on switchera
 * vers DaemonClientAdapter sans toucher le cœur.
 */

import { ComputerUseAdapter } from '../adapter.js';
import { ACTION_TYPES, WAIT_TYPES } from '../types.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('MacOsDirectAdapter');

// Timeout par type d'action (ms) — identiques aux skills existants
const ACTION_TIMEOUTS = {
  [ACTION_TYPES.SCREENSHOT]:   6_000,
  [ACTION_TYPES.TYPE_TEXT]:    4_000,
  [ACTION_TYPES.PRESS_KEY]:    3_000,
  [ACTION_TYPES.CLICK]:       10_000,
  [ACTION_TYPES.SMART_CLICK]: 15_000,
  [ACTION_TYPES.FIND_ELEMENT]:15_000,
  [ACTION_TYPES.OPEN_APP]:     5_000,
  [ACTION_TYPES.GOTO_URL]:     8_000,
  [ACTION_TYPES.SCROLL]:       5_000,
  [ACTION_TYPES.DRAG]:        10_000,
  [ACTION_TYPES.WAIT]:        30_000,
};

export class MacOsDirectAdapter extends ComputerUseAdapter {
  constructor(machineId = 'mac-local') {
    super(machineId, { type: 'macos_direct' });
    // Lazy-load le skill loader pour éviter les imports circulaires
    this._skillRunner = null;
  }

  async _getSkillRunner() {
    if (!this._skillRunner) {
      const { getAllSkillHandlers } = await import('../../skills/skillLoader.js');
      this._skillRunner = await getAllSkillHandlers();
    }
    return this._skillRunner;
  }

  async _runSkill(skillName, params = {}) {
    const t0 = Date.now();
    try {
      const handlers = await this._getSkillRunner();
      const handler = handlers[skillName];
      if (!handler) throw new Error(`Skill "${skillName}" introuvable`);
      const result = await Promise.race([
        handler(params),
        new Promise((_, rej) =>
          setTimeout(() => rej(new Error(`Timeout skill ${skillName}`)),
            ACTION_TIMEOUTS[params._actionType] || 15_000)
        ),
      ]);
      return { success: true, data: result, duration_ms: Date.now() - t0 };
    } catch (err) {
      logger.warn(`[${this.machineId}] Skill "${skillName}" échoué: ${err.message}`);
      return { success: false, error: err.message, duration_ms: Date.now() - t0 };
    }
  }

  // ── health ──────────────────────────────────────────────────────────────

  async health() {
    return this._timed(async () => {
      // Vérifie que le skill take_screenshot répond
      const result = await this._runSkill('take_screenshot', { path: '/tmp/ghost_health.png' });
      return {
        success: result.success,
        data: {
          machine_id: this.machineId,
          type:       'macos_direct',
          platform:   'darwin',
          skills_available: true,
        },
      };
    });
  }

  // ── observe ─────────────────────────────────────────────────────────────

  async observe(options = {}) {
    return this._timed(async () => {
      const params = {};
      if (options.app)   params.app   = options.app;
      if (options.roles) params.roles = options.roles;

      const result = await this._runSkill('screen_elements', params);
      if (!result.success) {
        // Fallback sur accessibility_reader si screen_elements échoue
        const fallback = await this._runSkill('accessibility_reader', params);
        return fallback.success
          ? { success: true,  data: fallback.data }
          : { success: false, error: fallback.error };
      }
      return { success: true, data: result.data };
    });
  }

  // ── act ─────────────────────────────────────────────────────────────────

  async act(action) {
    const { type, params = {} } = action;
    const timedParams = { ...params, _actionType: type };

    switch (type) {
      case ACTION_TYPES.SCREENSHOT:
        return this.screenshot(params);

      case ACTION_TYPES.TYPE_TEXT:
        return this._runSkill('type_text', timedParams);

      case ACTION_TYPES.PRESS_KEY:
        return this._runSkill('press_key', timedParams);

      case ACTION_TYPES.CLICK:
        // Délègue à mouse_control pour le clic direct par coordonnées
        return this._runSkill('mouse_control', {
          action: params.double ? 'double_click' : 'click',
          x: params.x,
          y: params.y,
          button: params.button || 'left',
          _actionType: type,
        });

      case ACTION_TYPES.SMART_CLICK:
        return this._runSkill('smart_click', timedParams);

      case ACTION_TYPES.FIND_ELEMENT:
        return this._runSkill('find_element', timedParams);

      case ACTION_TYPES.OPEN_APP:
        return this._runSkill('open_app', timedParams);

      case ACTION_TYPES.GOTO_URL:
        return this._runSkill('goto_url', timedParams);

      case ACTION_TYPES.SCROLL:
        return this._runSkill('mouse_control', {
          action: 'scroll',
          x: params.x || 0,
          y: params.y || 0,
          direction: params.direction || 'down',
          amount: params.amount || 3,
          _actionType: type,
        });

      case ACTION_TYPES.DRAG:
        return this._runSkill('mouse_control', {
          action: 'drag',
          x: params.x1,
          y: params.y1,
          x2: params.x2,
          y2: params.y2,
          _actionType: type,
        });

      case ACTION_TYPES.WAIT:
        await new Promise(r => setTimeout(r, params.ms || 1000));
        return { success: true, data: { waited_ms: params.ms || 1000 } };

      default:
        return { success: false, error: `Action inconnue: "${type}"` };
    }
  }

  // ── screenshot ──────────────────────────────────────────────────────────

  async screenshot(options = {}) {
    return this._timed(async () => {
      const path = options.path || `/tmp/ghost_shot_${Date.now()}.png`;
      const result = await this._runSkill('take_screenshot', { path });
      return result.success
        ? { success: true,  data: { path, ...result.data } }
        : { success: false, error: result.error };
    });
  }

  // ── waitFor ─────────────────────────────────────────────────────────────

  async waitFor(condition, timeoutMs = 10000) {
    const { type, params = {} } = condition;

    switch (type) {
      case WAIT_TYPES.ELEMENT_VISIBLE:
        return this._runSkill('wait_for_element', {
          query:   params.query,
          timeout: timeoutMs,
          _actionType: ACTION_TYPES.WAIT,
        });

      case WAIT_TYPES.SCREEN_STABLE: {
        // Prend 2 screenshots à N ms d'intervalle, compare les hashes
        const interval = params.interval_ms || 500;
        const deadline = Date.now() + timeoutMs;
        let lastHash = null;
        while (Date.now() < deadline) {
          const shot = await this.screenshot();
          if (!shot.success) break;
          const hash = shot.data?.hash || shot.data?.path;
          if (hash && hash === lastHash) return { success: true, data: { stable: true } };
          lastHash = hash;
          await new Promise(r => setTimeout(r, interval));
        }
        return { success: true, data: { stable: false, reason: 'screen still changing' } };
      }

      default:
        // Fallback générique : wait_for_element
        return this._runSkill('wait_for_element', {
          query:   params.query || JSON.stringify(condition),
          timeout: timeoutMs,
          _actionType: ACTION_TYPES.WAIT,
        });
    }
  }
}
