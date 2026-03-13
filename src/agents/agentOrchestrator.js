/**
 * agentOrchestrator.js — Orchestrateur multi-agents LaRuche v4.1
 *
 * Expose une API pour lancer N agents en parallèle sur des sous-tâches,
 * collecter leurs résultats et les synthétiser.
 *
 * Usage:
 *   import { orchestrate } from './agentOrchestrator.js'
 *   const result = await orchestrate('Analyse ce projet et génère un rapport', { hudFn })
 */

import { runAgentLoop } from './agentLoop.js';
import { ask } from '../model_router.js';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';
import { promisify } from 'util';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../../');
const execFileAsync = promisify(execFile);

// ─── Kimi-Overdrive : exécution parallèle via worker_pool.py ─────────────────────────

/**
 * Lance N tâches en parallèle via worker_pool.py (Python async + Ollama).
 * 10 instances max, semaphore-limité, shadow logging SQLite.
 * Plus rapide que N appels JS séquentiels pour les micro-tâches Ollama.
 */
async function kimiOverdrive(tasks) {
  // Sérialiser les tâches pour worker_pool.py
  const taskList = tasks.map((t, i) => ({
    id: `t${i + 1}`,
    description: t.task,
    tokens_budget: 500,
    temperature: 0.1,
  }));

  const script = `
import asyncio, json, sys
sys.path.insert(0, '${ROOT}src')
from worker_pool import WorkerTask, execute_parallel, chain_of_thought

async def run():
    tasks = [WorkerTask(**t) for t in ${JSON.stringify(taskList)}]
    results = await execute_parallel(tasks)
    synthesis = await chain_of_thought(results)
    print(json.dumps({
        "results": [{"id": r.task_id, "output": r.output, "success": r.success, "duration": r.duration} for r in results],
        "synthesis": synthesis,
        "success_count": sum(1 for r in results if r.success),
        "total": len(results)
    }))

asyncio.run(run())
`;

  try {
    const { stdout } = await execFileAsync("python3", ["-c", script], {
      cwd: ROOT,
      timeout: 120000,
      env: { ...process.env },
    });
    return JSON.parse(stdout.trim());
  } catch (e) {
    return null;  // fallback vers orchestration JS
  }
}

// ─── Découpe une mission en sous-tâches via LLM ─────────────────────────────────────────

async function decomposeMission(mission) {
  const prompt = `Décompose cette mission en 2-4 sous-tâches indépendantes exécutables en parallèle.
Mission: "${mission}"
Réponds uniquement en JSON: {"subtasks": [{"id": 1, "task": "...", "agent": "worker|architect|vision"}]}`;

  const result = await ask(prompt, { role: 'worker', temperature: 0.1, timeout: 20000 });
  if (!result.success || !result.text) {
    return [{ id: 1, task: mission, agent: 'worker' }];
  }

  try {
    const match = result.text.match(/\{[\s\S]*\}/);
    if (!match) return [{ id: 1, task: mission, agent: 'worker' }];
    const parsed = JSON.parse(match[0]);
    return Array.isArray(parsed.subtasks) && parsed.subtasks.length > 0
      ? parsed.subtasks
      : [{ id: 1, task: mission, agent: 'worker' }];
  } catch {
    return [{ id: 1, task: mission, agent: 'worker' }];
  }
}

// ─── Mapping rôle → nom agent YAML ──────────────────────────────────────────────────────

function agentNameForRole(role) {
  const map = {
    'worker':    'worker',
    'architect': 'architect',
    'vision':    'vision',
    'strategist':'strategist',
    'operator':  'operator',
  };
  const name = map[role] || 'worker';
  // Vérifier que le fichier de config existe
  const configPath = join(ROOT, `config/agents/${name}.yaml`);
  return existsSync(configPath) ? name : 'operator';
}

// ─── Synthèse des résultats parallèles ──────────────────────────────────────────────────

async function synthesizeResults(mission, subtaskResults) {
  const context = subtaskResults
    .map((r, i) => `[Sous-tâche ${i + 1}] ${r.task}\nRésultat: ${r.response?.slice(0, 400) || r.error || 'vide'}`)
    .join('\n\n');

  const prompt = `Synthétise ces résultats de sous-tâches pour répondre à la mission principale.
Mission: "${mission}"
${context}
Réponse courte, directe et complète:`;

  const result = await ask(prompt, { role: 'synthesizer', temperature: 0.3, timeout: 30000 });
  return result.text || subtaskResults.map(r => r.response).filter(Boolean).join('\n\n');
}

// ─── Orchestrateur principal ─────────────────────────────────────────────────────────────

/**
 * Lance N agents en parallèle sur les sous-tâches d'une mission.
 *
 * Mode automatique :
 * - Si toutes les tâches sont "worker" et pas de outils GUI → Kimi-Overdrive (Python async)
 * - Sinon → AgentLoop JS avec HITL + outils réels
 *
 * @param {string} mission
 * @param {{ hudFn?: Function, maxParallel?: number, useAgentLoop?: boolean, forceKimi?: boolean }} options
 */
export async function orchestrate(mission, { hudFn, maxParallel = 4, useAgentLoop = false, forceKimi = false } = {}) {
  const startTime = Date.now();
  hudFn?.({ type: 'thinking', agent: 'Orchestrator', thought: `Décompose: "${mission.slice(0, 60)}"` });

  // 1. Décomposer la mission
  const subtasks = await decomposeMission(mission);
  hudFn?.({ type: 'plan_ready', tasks: subtasks.length });

  // 2. Limiter le parallélisme
  const tasks = subtasks.slice(0, maxParallel);

  // 3. Kimi-Overdrive path : toutes tâches textuelles/worker → Python async pool
  const allWorkerTasks = tasks.every(t => t.agent === 'worker' || t.agent === 'architect');
  if ((allWorkerTasks || forceKimi) && !useAgentLoop) {
    hudFn?.({ type: 'thinking', agent: 'Kimi-Overdrive', thought: `${tasks.length} tâches parallèles → worker_pool.py` });
    const kimiResult = await kimiOverdrive(tasks);

    if (kimiResult) {
      hudFn?.({ type: 'mission_complete', duration: Date.now() - startTime });
      const results = kimiResult.results.map((r, i) => ({
        ...tasks[i],
        response: r.output,
        success: r.success,
        model: 'llama3.2:3b',
        duration: r.duration,
        source: 'kimi-overdrive',
      }));
      return {
        success: kimiResult.success_count > 0,
        response: kimiResult.synthesis,
        subtasks: results,
        duration: Date.now() - startTime,
        completedTasks: kimiResult.success_count,
        totalTasks: kimiResult.total,
        source: 'kimi-overdrive',
      };
    }
    // Kimi-Overdrive échoué → fallback JS
    hudFn?.({ type: 'thinking', agent: 'Orchestrator', thought: 'Kimi-Overdrive indisponible → fallback JS' });
  }

  // 4. Exécution JS parallèle (AgentLoop ou ask direct)
  const results = await Promise.all(tasks.map(async (subtask) => {
    hudFn?.({ type: 'task_start', task: `Agent ${subtask.agent}: ${subtask.task.slice(0, 50)}` });

    try {
      let response, model;

      if (useAgentLoop) {
        const agentName = agentNameForRole(subtask.agent);
        const loopResult = await runAgentLoop({
          agentName,
          userInput: subtask.task,
          onThought: (t) => hudFn?.({ type: 'thinking', agent: subtask.agent, thought: t.slice(0, 80) }),
          onToolCall: (tool, args) => hudFn?.({ type: 'task_start', task: `${tool}(${JSON.stringify(args).slice(0, 40)})` }),
        });
        response = loopResult.response;
        model = subtask.agent;
      } else {
        const askResult = await ask(subtask.task, {
          role: subtask.agent,
          temperature: 0.3,
          timeout: 60000,
        });
        response = askResult.text;
        model = askResult.model;
      }

      hudFn?.({ type: 'task_done', task: `Agent ${subtask.agent}`, status: 'ok' });
      return { ...subtask, response, model, success: true };

    } catch (err) {
      hudFn?.({ type: 'task_done', task: `Agent ${subtask.agent}`, status: 'error', error: err.message });
      return { ...subtask, response: '', error: err.message, success: false };
    }
  }));

  // 4. Synthèse
  hudFn?.({ type: 'thinking', agent: 'Synthesizer', thought: 'Fusion des résultats...' });
  const finalResponse = results.length === 1
    ? results[0].response
    : await synthesizeResults(mission, results);

  const duration = Date.now() - startTime;
  hudFn?.({ type: 'mission_complete', duration });

  return {
    success: results.some(r => r.success),
    response: finalResponse,
    subtasks: results,
    duration,
    completedTasks: results.filter(r => r.success).length,
    totalTasks: results.length,
  };
}

/**
 * Lance un seul agent nommé directement sur une tâche.
 * @param {string} agentName  nom du fichier YAML dans config/agents/
 * @param {string} task
 * @param {{ hudFn?: Function }} options
 */
export async function runAgent(agentName, task, { hudFn } = {}) {
  hudFn?.({ type: 'thinking', agent: agentName, thought: task.slice(0, 80) });

  const configPath = join(ROOT, `config/agents/${agentName}.yaml`);
  if (!existsSync(configPath)) {
    return { success: false, error: `Agent config not found: config/agents/${agentName}.yaml` };
  }

  const result = await runAgentLoop({
    agentName,
    userInput: task,
    onThought: (t) => hudFn?.({ type: 'thinking', agent: agentName, thought: t.slice(0, 80) }),
    onToolCall: (tool, args) => hudFn?.({ type: 'task_start', task: `${agentName}:${tool}` }),
    onIteration: (n) => hudFn?.({ type: 'thinking', agent: agentName, thought: `Itération ${n}` }),
  });

  return result;
}
