/**
 * src/goals-scheduler.js — Jarvis Goals Autonomous Scheduler
 *
 * Lit data/jarvis-goals.json au démarrage.
 * Schedule chaque goal actif via node-cron.
 * Exécute via POST /api/mission sur queen_oss.js (:3002).
 * Log résultats dans data/goals-history.jsonl.
 * Notifie Telegram si goal.notify=true.
 */

import cron from 'node-cron';
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
dotenv.config();

const __dirname  = dirname(fileURLToPath(import.meta.url));
const ROOT       = resolve(__dirname, '..');
const GOALS_PATH = resolve(ROOT, 'data/jarvis-goals.json');
const HISTORY    = resolve(ROOT, 'data/goals-history.jsonl');
const QUEEN_URL  = `http://localhost:${process.env.API_PORT || '3002'}`;
const TOKEN      = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_ID   = process.env.ADMIN_TELEGRAM_ID;

// ─── Utilitaires ─────────────────────────────────────────────────────────────
function loadGoals() {
  try {
    return JSON.parse(readFileSync(GOALS_PATH, 'utf8'));
  } catch (e) {
    console.error('[Goals] Erreur lecture goals.json:', e.message);
    return { goals: [] };
  }
}

function saveGoals(data) {
  data.lastUpdated = new Date().toISOString();
  writeFileSync(GOALS_PATH, JSON.stringify(data, null, 2));
}

function logHistory(entry) {
  appendFileSync(HISTORY, JSON.stringify(entry) + '\n');
}

async function sendTelegram(text) {
  if (!TOKEN || !ADMIN_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: ADMIN_ID, text, parse_mode: 'Markdown' }),
      signal: AbortSignal.timeout(10000),
    });
  } catch {}
}

// ─── Exécuter un goal ─────────────────────────────────────────────────────────
async function executeGoal(goal) {
  const t0 = Date.now();
  console.log(`[Goals] Exécution goal: ${goal.id} — "${goal.command.slice(0, 60)}"`);

  let result;
  try {
    const res = await fetch(`${QUEEN_URL}/api/mission`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        command: goal.command,
        priority: 2,
        source: `goals-scheduler:${goal.id}`,
      }),
      signal: AbortSignal.timeout(120_000),
    });
    result = await res.json();
  } catch (err) {
    result = { status: 'error', error: err.message };
  }

  const duration = Date.now() - t0;
  const success  = result.status === 'completed';

  // Mettre à jour stats dans goals.json
  const data = loadGoals();
  const goalEntry = data.goals.find(g => g.id === goal.id);
  if (goalEntry) {
    goalEntry.lastRun  = new Date().toISOString();
    goalEntry.runCount = (goalEntry.runCount || 0) + 1;
    saveGoals(data);
  }

  // Log historique
  logHistory({
    ts:       new Date().toISOString(),
    goalId:   goal.id,
    command:  goal.command,
    status:   result.status || 'unknown',
    duration,
    skill:    goal.skill,
    output:   (result.output || result.summary || '').slice(0, 300),
  });

  // Notification Telegram si demandé
  if (goal.notify && TOKEN) {
    const icon = success ? '✅' : '⚠️';
    const output = result.output || result.summary || result.error || 'Pas de résultat';
    await sendTelegram(
      `${icon} *Goal: ${goal.name || goal.id}*\n${output.slice(0, 500)}`
    );
  }

  console.log(`[Goals] ${goal.id} → ${result.status} (${duration}ms)`);
  return { success, duration, result };
}

// ─── Scheduler principal ──────────────────────────────────────────────────────
const scheduledJobs = new Map();

function scheduleGoals() {
  const { goals } = loadGoals();
  let scheduled = 0;

  for (const goal of goals) {
    if (!goal.active) continue;
    if (!cron.validate(goal.cron)) {
      console.warn(`[Goals] Cron invalide pour ${goal.id}: "${goal.cron}"`);
      continue;
    }

    const job = cron.schedule(goal.cron, () => executeGoal(goal), {
      timezone: 'Europe/Paris',
    });
    scheduledJobs.set(goal.id, job);
    scheduled++;
    console.log(`[Goals] Schedulé: ${goal.id} (${goal.cron})`);
  }

  console.log(`[Goals] ✅ ${scheduled} goals actifs schedulés`);
  return scheduled;
}

// ─── API HTTP minimale (GET /goals/list, POST /goals/run/:id) ─────────────────
import { createServer } from 'http';
const GOALS_PORT = parseInt(process.env.GOALS_PORT || '3005');

const apiServer = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${GOALS_PORT}`);
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200);
    res.end(JSON.stringify({ ok: true, service: 'goals-scheduler', scheduled: scheduledJobs.size }));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/goals/list') {
    const { goals } = loadGoals();
    res.writeHead(200);
    res.end(JSON.stringify({ goals, scheduled: scheduledJobs.size }));
    return;
  }

  // POST /goals/run/:id — exécuter un goal immédiatement
  const runMatch = url.pathname.match(/^\/goals\/run\/([^/]+)$/);
  if (req.method === 'POST' && runMatch) {
    const id = runMatch[1];
    const { goals } = loadGoals();
    const goal = goals.find(g => g.id === id);
    if (!goal) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: `Goal inconnu: ${id}` }));
      return;
    }
    const result = await executeGoal(goal);
    res.writeHead(200);
    res.end(JSON.stringify(result));
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Route introuvable' }));
});

apiServer.listen(GOALS_PORT, () => {
  console.log(`[Goals] API sur :${GOALS_PORT}`);
});

// ─── Démarrage ────────────────────────────────────────────────────────────────
const count = scheduleGoals();

process.on('SIGINT',  () => { scheduledJobs.forEach(j => j.stop()); process.exit(0); });
process.on('SIGTERM', () => { scheduledJobs.forEach(j => j.stop()); process.exit(0); });
