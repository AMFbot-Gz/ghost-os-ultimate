/**
 * src/orchestrator.js — Orchestrateur central Jarvis
 *
 * Dispatche une commande Telegram vers le bon canal :
 *   1. Fiche Métier match → exécute chaque étape via skill_runner
 *   2. Sinon → POST /api/mission sur queen-node :3002 (Butterfly Loop)
 *
 * Interface :
 *   const r = await execute('rapport ventes du jour', onEvent);
 *   // r = { success, result, fiche, workflow, agents_ok, duration_ms, source }
 */

import { matchFicheMetier } from './metiers.js';
import { getWorldContext }   from './world-model.js';

const QUEEN_URL  = `http://localhost:${process.env.API_PORT || '3002'}`;
const SKILL_TIMEOUT = parseInt(process.env.SKILL_TIMEOUT_MS || '30000');
const MISSION_TIMEOUT = parseInt(process.env.MISSION_TIMEOUT_MS || '90000');

// ─── Skill runner local (appelle skills/core/{name}/skill.js) ─────────────────

import { createRequire } from 'module';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = resolve(__dirname, '../skills');

const _skillCache = new Map();

async function loadSkill(name) {
  if (_skillCache.has(name)) return _skillCache.get(name);
  const paths = [
    resolve(SKILLS_DIR, name, 'skill.js'),
    resolve(SKILLS_DIR, name, 'index.js'),
  ];
  for (const p of paths) {
    if (existsSync(p)) {
      const mod = await import(p);
      _skillCache.set(name, mod);
      return mod;
    }
  }
  return null;
}

async function runSkill(skillName, params) {
  const mod = await loadSkill(skillName);
  if (!mod?.run) return { success: false, error: `Skill "${skillName}" introuvable ou sans export run()` };
  try {
    return await Promise.race([
      mod.run(params),
      new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout ${SKILL_TIMEOUT}ms`)), SKILL_TIMEOUT)),
    ]);
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ─── Exécution d'une fiche métier ─────────────────────────────────────────────

async function executeFiche(workflow, onEvent) {
  const results = [];
  let allOk = true;

  for (const etape of workflow.etapes) {
    onEvent?.({ type: 'step_start', ordre: etape.ordre, skill: etape.skill });
    const result = await runSkill(etape.skill, etape.params);

    if (!result.success) {
      allOk = false;
      onEvent?.({ type: 'step_error', ordre: etape.ordre, skill: etape.skill, error: result.error });
      results.push({ ...result, etape: etape.ordre, skill: etape.skill });
      break; // arrêt au premier échec
    }

    onEvent?.({ type: 'step_done', ordre: etape.ordre, skill: etape.skill });
    results.push({ ...result, etape: etape.ordre, skill: etape.skill });
  }

  return { success: allOk, results };
}

// ─── Mission générale via queen-node ─────────────────────────────────────────

async function queenMission(command, onEvent) {
  // Injecter le contexte world model dans la commande
  let enrichedCommand = command;
  try {
    const ctx = await getWorldContext();
    if (ctx) enrichedCommand = `[Contexte: ${ctx}]\n${command}`;
  } catch { /* contexte optionnel */ }

  onEvent?.({ type: 'queen_dispatch', command: enrichedCommand.slice(0, 80) });

  const res = await fetch(`${QUEEN_URL}/api/mission`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command: enrichedCommand, priority: 3 }),
    signal: AbortSignal.timeout(MISSION_TIMEOUT),
  });

  if (!res.ok) throw new Error(`Queen HTTP ${res.status}`);
  const data = await res.json();

  // Polling si statut pending (max 80s)
  if (data.status === 'pending' && data.missionId) {
    const missionId = data.missionId;
    const deadline  = Date.now() + MISSION_TIMEOUT;

    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 2000));
      try {
        const poll = await fetch(`${QUEEN_URL}/api/missions/${missionId}`, {
          signal: AbortSignal.timeout(5000),
        });
        const d = await poll.json();
        if (d.status === 'success' || d.status === 'completed') {
          return { success: true,  result: d.result || d.output || JSON.stringify(d).slice(0, 500), agents_ok: true };
        }
        if (d.status === 'failed' || d.status === 'error') {
          return { success: false, result: d.error || 'Mission échouée', agents_ok: false };
        }
        onEvent?.({ type: 'polling', status: d.status });
      } catch { /* continue */ }
    }
    return { success: false, result: 'Timeout mission (90s)', agents_ok: false };
  }

  return {
    success: data.status === 'success' || data.status === 'completed',
    result: data.result || data.output || data.status,
    agents_ok: true,
  };
}

// ─── Point d'entrée principal ─────────────────────────────────────────────────

/**
 * Execute une commande en langage naturel.
 *
 * @param {string} command - message Telegram original
 * @param {Function} onEvent - callback(event) pour le streaming Telegram
 * @returns {Promise<{
 *   success: boolean,
 *   result: string,
 *   fiche: object|null,
 *   workflow: object|null,
 *   agents_ok: boolean,
 *   duration_ms: number,
 *   source: 'fiche'|'queen'
 * }>}
 */
export async function execute(command, onEvent = () => {}) {
  const t0 = Date.now();

  // 1. Tente le match fiche métier
  const { fiche, workflow } = matchFicheMetier(command);

  if (fiche && workflow) {
    onEvent({ type: 'fiche_match', fiche: fiche.nom, workflow: workflow.nom });

    const exec = await executeFiche(workflow, onEvent);
    const duration_ms = Date.now() - t0;

    // Formater le résultat pour Telegram
    const lines = exec.results.map(r => {
      const icon = r.success ? '✅' : '❌';
      const body = r.result != null
        ? JSON.stringify(r.result).slice(0, 200)
        : r.error?.slice(0, 100) || '';
      return `${icon} ${r.skill}: ${body}`;
    });

    return {
      success:     exec.success,
      result:      exec.success ? `${workflow.livrable}\n\n${lines.join('\n')}` : lines.join('\n'),
      fiche,
      workflow,
      agents_ok:   exec.success,
      duration_ms,
      source:      'fiche',
    };
  }

  // 2. Fallback queen-node Butterfly Loop
  onEvent({ type: 'queen_fallback' });
  try {
    const q = await queenMission(command, onEvent);
    return {
      ...q,
      fiche:    null,
      workflow: null,
      duration_ms: Date.now() - t0,
      source:   'queen',
    };
  } catch (e) {
    return {
      success:    false,
      result:     `❌ Orchestrateur erreur : ${e.message}`,
      fiche:      null,
      workflow:   null,
      agents_ok:  false,
      duration_ms: Date.now() - t0,
      source:     'queen',
    };
  }
}
