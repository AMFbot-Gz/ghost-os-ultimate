/**
 * src/subagents/subagentManager.js — Gestionnaire central des sous-agents LaRuche
 *
 * Responsabilités :
 *  - Enregistrer les configs de sous-agents (devAgent, opsAgent, knowledgeAgent)
 *  - Dispatcher des tâches vers un sous-agent en respectant les contraintes
 *    (concurrence max, timeout, skills autorisés)
 *  - Collecter les stats par sous-agent (missions, succès, timing)
 *  - Broadcaster les events HUD (subagent_start, subagent_done, subagent_error)
 */

import { randomUUID } from "crypto";

// ─── Constantes ────────────────────────────────────────────────────────────────
const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://localhost:11434";

// ─── SubagentManager ──────────────────────────────────────────────────────────

export class SubagentManager {
  /**
   * @param {{
   *   logger?: import('winston').Logger,
   *   broadcastHUD?: (event: Object) => void,
   *   runMission?: (command: string, missionId?: string) => Promise<string>,
   * }} deps
   */
  constructor(deps = {}) {
    /** @type {Map<string, Object>} config enregistrée par id */
    this._configs = new Map();

    /** @type {Map<string, { running: number, total: number, success: number, failed: number, totalMs: number }>} */
    this._stats = new Map();

    /** @type {Map<string, Set<string>>} tâches actives par sous-agent */
    this._activeTasks = new Map();

    // Dépendances injectables (logger, HUD, runMission)
    this._logger = deps.logger || null;
    this._broadcastHUD = deps.broadcastHUD || (() => {});
    this._runMission = deps.runMission || null;
  }

  /**
   * Injecte les dépendances après construction (utile pour éviter les imports circulaires)
   * @param {{ logger, broadcastHUD, runMission }} deps
   */
  setDeps(deps) {
    if (deps.logger) this._logger = deps.logger;
    if (deps.broadcastHUD) this._broadcastHUD = deps.broadcastHUD;
    if (deps.runMission) this._runMission = deps.runMission;
  }

  // ─── Logging interne ─────────────────────────────────────────────────────────

  _log(level, msg, meta = {}) {
    if (this._logger) {
      this._logger[level](`[SubagentManager] ${msg}`, meta);
    }
  }

  // ─── register ────────────────────────────────────────────────────────────────

  /**
   * Enregistre un sous-agent depuis sa config objet.
   * Idempotent : un deuxième register sur le même id écrase la config.
   *
   * @param {Object} config
   * @param {string} config.id
   * @param {string} config.name
   * @param {string} [config.description]
   * @param {string} [config.model]
   * @param {string[]} [config.allowedSkills]
   * @param {string[]} [config.allowedMCPs]
   * @param {string} [config.systemPrompt]
   * @param {number} [config.maxConcurrent]
   * @param {number} [config.timeout]
   */
  register(config) {
    if (!config?.id) throw new Error("SubagentManager.register : config.id requis");
    if (!config?.name) throw new Error("SubagentManager.register : config.name requis");

    this._configs.set(config.id, {
      id: config.id,
      name: config.name,
      icon: config.icon || "🤖",
      color: config.color || "#6b7280",
      description: config.description || "",
      model: config.model || "llama3.2:3b",
      allowedSkills: Array.isArray(config.allowedSkills) ? config.allowedSkills : [],
      allowedMCPs: Array.isArray(config.allowedMCPs) ? config.allowedMCPs : [],
      systemPrompt: config.systemPrompt || "",
      capabilities: Array.isArray(config.capabilities) ? config.capabilities : [],
      maxConcurrent: config.maxConcurrent ?? 2,
      timeout: config.timeout ?? 120_000,
      registeredAt: new Date().toISOString(),
    });

    // Initialise les stats si premier enregistrement
    if (!this._stats.has(config.id)) {
      this._stats.set(config.id, {
        running: 0,
        total: 0,
        success: 0,
        failed: 0,
        totalMs: 0,
        avgMs: 0,
        lastTaskAt: null,
      });
    }

    // Initialise le set de tâches actives
    if (!this._activeTasks.has(config.id)) {
      this._activeTasks.set(config.id, new Set());
    }

    this._log("info", `Sous-agent enregistré : ${config.name} (${config.id}) → ${config.model}`);
  }

  // ─── list ─────────────────────────────────────────────────────────────────────

  /**
   * Retourne la liste de tous les sous-agents enregistrés avec leurs stats.
   * @returns {Array<Object>}
   */
  list() {
    return Array.from(this._configs.values()).map((cfg) => ({
      ...cfg,
      stats: this._stats.get(cfg.id) || {},
    }));
  }

  // ─── stats ────────────────────────────────────────────────────────────────────

  /**
   * Retourne les stats d'un sous-agent.
   * @param {string} agentId
   * @returns {Object|null}
   */
  stats(agentId) {
    if (!this._configs.has(agentId)) return null;
    const cfg = this._configs.get(agentId);
    const st = this._stats.get(agentId) || {};
    return {
      agentId,
      name: cfg.name,
      model: cfg.model,
      ...st,
      activeTasks: this._activeTasks.get(agentId)?.size || 0,
    };
  }

  // ─── dispatch ─────────────────────────────────────────────────────────────────

  /**
   * Lance un sous-agent sur une tâche.
   * Gère : vérification d'existence, contrôle de concurrence, validation des skills,
   * timeout, stats, et broadcast HUD.
   *
   * @param {string} agentId
   * @param {string} task
   * @param {{
   *   context?: Object,
   *   skill?: string,
   *   taskId?: string,
   * }} opts
   * @returns {Promise<{
   *   taskId: string,
   *   agentId: string,
   *   status: "success" | "error" | "timeout",
   *   result?: string,
   *   error?: string,
   *   durationMs: number,
   * }>}
   */
  async dispatch(agentId, task, opts = {}) {
    // ── 1. Validation agent ──────────────────────────────────────────────────
    const cfg = this._configs.get(agentId);
    if (!cfg) {
      const err = `Sous-agent inconnu : ${agentId}`;
      this._log("warn", err);
      throw new Error(err);
    }

    // ── 2. Validation skill (si fourni) ────────────────────────────────────
    if (opts.skill && cfg.allowedSkills.length > 0 && !cfg.allowedSkills.includes(opts.skill)) {
      const err = `Sous-agent ${agentId} : skill non autorisé → ${opts.skill}`;
      this._log("warn", err);
      throw new Error(err);
    }

    // ── 3. Contrôle de concurrence ─────────────────────────────────────────
    const active = this._activeTasks.get(agentId);
    if (active.size >= cfg.maxConcurrent) {
      const err = `Sous-agent ${agentId} : limite de concurrence atteinte (${cfg.maxConcurrent})`;
      this._log("warn", err);
      throw new Error(err);
    }

    const taskId = opts.taskId || `sa-${Date.now()}-${randomUUID().slice(0, 6)}`;
    const startMs = Date.now();

    // ── 4. Enregistrer la tâche active ────────────────────────────────────
    active.add(taskId);
    this._updateStats(agentId, { running: 1 });

    this._log("info", `Dispatch ${cfg.name} → "${task.slice(0, 80)}"`, { taskId, agentId });

    // Broadcast HUD : démarrage
    this._broadcastHUD({
      type: "subagent_start",
      agentId,
      agentName: cfg.name,
      agentIcon: cfg.icon,
      taskId,
      task: task.slice(0, 100),
    });

    // ── 5. Exécution avec timeout ─────────────────────────────────────────
    let result;
    try {
      result = await this._executeWithTimeout(cfg, task, opts, taskId, cfg.timeout);
    } catch (err) {
      // Timeout ou erreur d'exécution
      const durationMs = Date.now() - startMs;
      const isTimeout = err.message?.includes("timeout");

      active.delete(taskId);
      this._updateStats(agentId, {
        running: -1,
        total: 1,
        failed: 1,
        totalMs: durationMs,
      });

      this._log("error", `${cfg.name} [${taskId}] ${isTimeout ? "timeout" : "erreur"} : ${err.message}`, { agentId, durationMs });

      this._broadcastHUD({
        type: "subagent_error",
        agentId,
        agentName: cfg.name,
        agentIcon: cfg.icon,
        taskId,
        error: err.message,
        durationMs,
        isTimeout,
      });

      return {
        taskId,
        agentId,
        status: isTimeout ? "timeout" : "error",
        error: err.message,
        durationMs,
      };
    }

    // ── 6. Succès ─────────────────────────────────────────────────────────
    const durationMs = Date.now() - startMs;

    active.delete(taskId);
    this._updateStats(agentId, {
      running: -1,
      total: 1,
      success: 1,
      totalMs: durationMs,
    });

    this._log("info", `${cfg.name} [${taskId}] terminé en ${durationMs}ms`, { agentId });

    this._broadcastHUD({
      type: "subagent_done",
      agentId,
      agentName: cfg.name,
      agentIcon: cfg.icon,
      taskId,
      durationMs,
      success: true,
    });

    return {
      taskId,
      agentId,
      status: "success",
      result,
      durationMs,
    };
  }

  // ─── Exécution interne ────────────────────────────────────────────────────────

  /**
   * Exécute la tâche via Ollama (appel direct) ou runMission selon la config.
   * Wrapped dans une Promise.race avec un timeout.
   */
  async _executeWithTimeout(cfg, task, opts, taskId, timeoutMs) {
    const executionPromise = this._runSubagentTask(cfg, task, opts);

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`timeout après ${timeoutMs}ms`)), timeoutMs)
    );

    return Promise.race([executionPromise, timeoutPromise]);
  }

  /**
   * Appel LLM Ollama avec le system prompt du sous-agent.
   * Fallback sur runMission si Ollama indisponible.
   */
  async _runSubagentTask(cfg, task, opts = {}) {
    // Construire le prompt complet avec system prompt + contexte + tâche
    const contextStr = opts.context
      ? `\nContexte: ${JSON.stringify(opts.context).slice(0, 500)}\n`
      : "";

    const fullPrompt = cfg.systemPrompt
      ? `${cfg.systemPrompt}\n${contextStr}\nTâche: ${task}`
      : `${contextStr}${task}`;

    // Tentative d'appel direct Ollama
    try {
      const response = await fetch(`${OLLAMA_HOST}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: cfg.model,
          prompt: fullPrompt,
          stream: false,
          options: {
            temperature: 0.3,
            top_k: 20,
            num_predict: 700,
          },
        }),
        signal: AbortSignal.timeout(cfg.timeout - 2000), // marge de 2s pour le timeout global
      });

      if (!response.ok) {
        throw new Error(`Ollama HTTP ${response.status} pour ${cfg.model}`);
      }

      const data = await response.json();
      const text = data?.response || "";

      if (!text) throw new Error(`Ollama a retourné une réponse vide pour ${cfg.model}`);
      return text;

    } catch (ollamaErr) {
      // Fallback : runMission si disponible
      if (this._runMission) {
        this._log("warn", `Ollama indisponible pour ${cfg.model}, fallback runMission : ${ollamaErr.message}`);
        return this._runMission(task);
      }
      throw ollamaErr;
    }
  }

  // ─── Mise à jour des stats ────────────────────────────────────────────────────

  /**
   * @param {string} agentId
   * @param {{ running?: number, total?: number, success?: number, failed?: number, totalMs?: number }} delta
   */
  _updateStats(agentId, delta) {
    const st = this._stats.get(agentId);
    if (!st) return;

    if (delta.running !== undefined) st.running = Math.max(0, st.running + delta.running);
    if (delta.total) st.total += delta.total;
    if (delta.success) st.success += delta.success;
    if (delta.failed) st.failed += delta.failed;
    if (delta.totalMs) {
      st.totalMs += delta.totalMs;
      st.avgMs = st.total > 0 ? Math.round(st.totalMs / st.total) : 0;
    }

    st.lastTaskAt = new Date().toISOString();
    this._stats.set(agentId, st);
  }
}

// ─── Instance singleton exportée ─────────────────────────────────────────────
// Initialisée sans deps — celles-ci sont injectées via setDeps() dans queen_oss.js
export const subagentManager = new SubagentManager();
