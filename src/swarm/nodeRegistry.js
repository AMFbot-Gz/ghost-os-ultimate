/**
 * src/swarm/nodeRegistry.js — Registre des nœuds Ollama pour le swarm distribué
 *
 * Gestion multi-machines :
 *  - Lecture de config/swarm_nodes.yml au démarrage
 *  - Healthcheck périodique sur chaque nœud (/api/tags)
 *  - Mise à jour dynamique des modèles disponibles et latence EWMA
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Parser YAML minimaliste pour swarm_nodes.yml ─────────────────────────────
// On ne peut pas utiliser le parser flat de src/utils/yaml.js car la structure
// est imbriquée (swarm → nodes → liste d'objets). Ce parser inline gère le cas.

function parseSwarmYaml(raw) {
  const lines = raw.split('\n');
  const config = { enabled: false, healthCheckIntervalMs: 30000, selectionStrategy: 'least_loaded', nodes: [] };
  let inNodes = false;
  let currentNode = null;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    // Ignorer commentaires et lignes vides
    if (!line.trim() || line.trim().startsWith('#')) continue;

    const indent = line.length - line.trimStart().length;

    // Détection section "nodes:"
    if (/^\s{2,4}nodes\s*:/.test(line)) {
      inNodes = true;
      continue;
    }

    if (inNodes) {
      // Nouveau nœud (tiret de liste YAML au niveau 4)
      if (/^\s{4,6}-\s+id:/.test(line) || /^\s{4,6}-\s*$/.test(line)) {
        if (currentNode) config.nodes.push(currentNode);
        // Extraire l'id si sur la même ligne : "    - id: mac-local"
        const idMatch = line.match(/id:\s*(.+)/);
        currentNode = {
          id: idMatch ? idMatch[1].trim().replace(/^['"]|['"]$/g, '') : '',
          url: 'http://localhost:11434',
          models: [],
          role: 'primary',
          maxConcurrency: 3,
        };
        continue;
      }

      if (currentNode) {
        // Propriétés du nœud courant (indentation ≥ 6)
        const kv = line.match(/^\s+(id|url|role|maxConcurrency|models)\s*:\s*(.*)/);
        if (kv) {
          const key = kv[1];
          const val = kv[2].trim().replace(/^['"]|['"]$/g, '');
          if (key === 'models') {
            // Inline list : [a, b, c]
            if (val.startsWith('[') && val.endsWith(']')) {
              currentNode.models = val.slice(1, -1)
                .split(',')
                .map(v => v.trim().replace(/^['"]|['"]$/g, ''))
                .filter(Boolean);
            }
          } else if (key === 'maxConcurrency') {
            currentNode.maxConcurrency = parseInt(val, 10) || 3;
          } else {
            currentNode[key] = val;
          }
          continue;
        }
        // Modèles en liste tirets
        const listItem = line.match(/^\s+-\s+(.*)/);
        if (listItem) {
          currentNode.models.push(listItem[1].trim().replace(/^['"]|['"]$/g, ''));
        }
      }
    } else {
      // Propriétés de niveau "swarm:"
      const topKv = line.match(/^\s+(enabled|healthCheckIntervalMs|selectionStrategy)\s*:\s*(.*)/);
      if (topKv) {
        const key = topKv[1];
        const val = topKv[2].trim();
        if (key === 'enabled') config.enabled = val === 'true';
        else if (key === 'healthCheckIntervalMs') config.healthCheckIntervalMs = parseInt(val, 10) || 30000;
        else if (key === 'selectionStrategy') config.selectionStrategy = val.replace(/^['"]|['"]$/g, '');
      }
    }
  }

  // Flush dernier nœud
  if (currentNode) config.nodes.push(currentNode);

  return config;
}

// ─── Chargement de la config ──────────────────────────────────────────────────

async function parseSwarmConfig() {
  const cfgPath = join(__dirname, '../../config/swarm_nodes.yml');
  const fallback = {
    enabled: false,
    healthCheckIntervalMs: 30000,
    selectionStrategy: 'least_loaded',
    nodes: [{
      id: 'mac-local',
      url: process.env.OLLAMA_HOST || 'http://localhost:11434',
      models: [],
      role: 'primary',
      maxConcurrency: 3,
    }],
  };

  if (!existsSync(cfgPath)) return fallback;

  try {
    const raw = readFileSync(cfgPath, 'utf8');
    const parsed = parseSwarmYaml(raw);
    if (!parsed.nodes || parsed.nodes.length === 0) return fallback;
    return parsed;
  } catch {
    return fallback;
  }
}

// ─── NodeRegistry ─────────────────────────────────────────────────────────────

class NodeRegistry {
  constructor() {
    /** @type {Map<string, Object>} id → NodeState */
    this._nodes = new Map();
    this._timer = null;
    this._config = null;
  }

  /**
   * Initialise le registre : charge la config, peuple les nœuds, lance le healthcheck.
   */
  async init() {
    this._config = await parseSwarmConfig();

    for (const node of (this._config.nodes || [])) {
      this._nodes.set(node.id, {
        ...node,
        status: 'unknown',
        activeJobs: 0,
        avgLatencyMs: 100,
        lastCheck: null,
        models: node.models || [],
      });
    }

    // Premier healthcheck synchrone au démarrage
    await this._healthCheckAll();

    // Healthcheck périodique (non-bloquant avec unref)
    const interval = this._config.healthCheckIntervalMs || 30000;
    if (interval > 0) {
      this._timer = setInterval(() => this._healthCheckAll(), interval);
      if (this._timer.unref) this._timer.unref();
    }
  }

  // ─── Healthcheck ──────────────────────────────────────────────────────────────

  async _healthCheckAll() {
    await Promise.allSettled([...this._nodes.values()].map(n => this._checkNode(n)));
  }

  async _checkNode(node) {
    const t = Date.now();
    try {
      const r = await fetch(`${node.url}/api/tags`, {
        signal: AbortSignal.timeout(3000),
      });
      if (r.ok) {
        const { models } = await r.json();
        node.status = 'up';
        // EWMA latence
        node.avgLatencyMs = Math.round(0.8 * node.avgLatencyMs + 0.2 * (Date.now() - t));
        node.models = (models || []).map(m => m.name);
        node.lastCheck = new Date().toISOString();
      } else {
        node.status = 'down';
        node.lastCheck = new Date().toISOString();
      }
    } catch {
      node.status = 'down';
      node.lastCheck = new Date().toISOString();
    }
  }

  // ─── Accesseurs ──────────────────────────────────────────────────────────────

  /** Retourne tous les nœuds */
  getAll() {
    return [...this._nodes.values()];
  }

  /** Retourne un nœud par id */
  get(id) {
    return this._nodes.get(id);
  }

  /**
   * Retourne les nœuds disponibles pour un modèle donné.
   * Critères : status=up, activeJobs < maxConcurrency, modèle présent.
   * @param {string} [requiredModel]
   */
  getAvailable(requiredModel) {
    return [...this._nodes.values()].filter(n => {
      if (n.status !== 'up') return false;
      if (n.activeJobs >= n.maxConcurrency) return false;
      if (requiredModel && !n.models.some(m => m.startsWith(requiredModel.split(':')[0]))) return false;
      return true;
    });
  }

  /**
   * Statistiques globales du swarm.
   */
  stats() {
    const nodes = this.getAll();
    return {
      total: nodes.length,
      up: nodes.filter(n => n.status === 'up').length,
      down: nodes.filter(n => n.status === 'down').length,
      totalCapacity: nodes.reduce((s, n) => s + n.maxConcurrency, 0),
      activeJobs: nodes.reduce((s, n) => s + n.activeJobs, 0),
    };
  }
}

export const nodeRegistry = new NodeRegistry();
