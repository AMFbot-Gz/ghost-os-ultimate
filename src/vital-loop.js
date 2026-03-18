/**
 * src/vital-loop.js — Jarvis Vital Loop 24/7
 *
 * Toutes les 30s : vérifie chaque service critique
 * Si DOWN → pm2 restart avec backoff (5/15/60s), max 3 tentatives
 * Si toujours DOWN → alerte Telegram + log data/incidents.jsonl
 * Si UP → heartbeat silencieux dans data/heartbeat.log
 *
 * Rapport quotidien à 09h00 → Telegram
 */

import { execSync, exec } from 'child_process';
import { appendFileSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR   = resolve(__dirname, '../data');
const HEARTBEAT  = resolve(DATA_DIR, 'heartbeat.log');
const INCIDENTS  = resolve(DATA_DIR, 'incidents.jsonl');

const TOKEN    = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_TELEGRAM_ID;

// ─── Services à surveiller ──────────────────────────────────────────────────
const CHECKS = [
  { name: 'queen-node',     url: 'http://localhost:3002/api/health', critical: true,  pm2: 'queen-node' },
  { name: 'agents-python',  url: 'http://localhost:8001/health',     critical: true,  pm2: 'agents-python' },
  { name: 'brain-ollama',   url: 'http://localhost:8003/health',     critical: true,  pm2: null },
  { name: 'moltbot-bridge', url: 'http://localhost:3003/health',     critical: false, pm2: 'moltbot-bridge' },
  { name: 'ruche-bridge',   url: 'http://localhost:8020/health',     critical: false, pm2: 'ruche-bridge' },
  { name: 'memory-hub',     url: 'http://localhost:3004/health',     critical: false, pm2: 'memory-hub' },
];

// Compteurs par service : tentatives de restart en cours
const restartAttempts = new Map();
const serviceStats    = new Map(); // { upCount, downCount, lastStatus }

// Initialiser stats
CHECKS.forEach(c => serviceStats.set(c.name, { upCount: 0, downCount: 0, lastStatus: 'unknown', firstSeen: Date.now() }));

// ─── Utilitaires ────────────────────────────────────────────────────────────
async function checkService(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch {
    return false;
  }
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

function logIncident(event) {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...event });
  appendFileSync(INCIDENTS, line + '\n');
  console.error(`[VitalLoop] INCIDENT: ${JSON.stringify(event)}`);
}

function pm2Restart(name) {
  return new Promise((resolve) => {
    exec(`pm2 restart ${name} 2>&1`, (err, stdout) => {
      resolve(!err);
    });
  });
}

// ─── Cycle de vérification ───────────────────────────────────────────────────
let cycleCount = 0;
let totalMissions = 0;

async function runChecks() {
  cycleCount++;
  const ts = new Date().toISOString();
  const results = [];

  for (const svc of CHECKS) {
    const up = await checkService(svc.url);
    const stats = serviceStats.get(svc.name);

    if (up) {
      stats.upCount++;
      stats.lastStatus = 'up';
      restartAttempts.delete(svc.name); // reset restart counter
    } else {
      stats.downCount++;
      stats.lastStatus = 'down';

      if (svc.critical || svc.pm2) {
        const attempts = restartAttempts.get(svc.name) || 0;

        if (attempts < 3 && svc.pm2) {
          const backoff = [5000, 15000, 60000][attempts] || 60000;
          console.warn(`[VitalLoop] ${svc.name} DOWN — restart tentative ${attempts + 1}/3 (backoff ${backoff/1000}s)`);
          restartAttempts.set(svc.name, attempts + 1);

          setTimeout(async () => {
            const ok = await pm2Restart(svc.pm2);
            if (ok) {
              console.log(`[VitalLoop] ${svc.name} redémarré via PM2`);
            } else {
              logIncident({ service: svc.name, event: 'restart_failed', attempt: attempts + 1 });
            }
          }, backoff);

        } else if (attempts >= 3) {
          // 3 tentatives épuisées → alerte
          const alreadyAlerted = restartAttempts.get(svc.name + '_alerted');
          if (!alreadyAlerted) {
            restartAttempts.set(svc.name + '_alerted', true);
            const msg = `🚨 *Jarvis ALERTE*\n\`${svc.name}\` DOWN après 3 tentatives de restart.\nVérification manuelle requise.`;
            await sendTelegram(msg);
            logIncident({ service: svc.name, event: 'alert_sent', critical: svc.critical });
          }
        } else {
          // Service critique sans PM2 (brain-ollama)
          if (svc.critical && !restartAttempts.get(svc.name + '_alerted')) {
            restartAttempts.set(svc.name + '_alerted', true);
            await sendTelegram(`⚠️ *Jarvis WARNING*\n\`${svc.name}\` inaccessible — vérifier manuellement`);
            logIncident({ service: svc.name, event: 'critical_down_no_pm2' });
          }
        }
      }
    }

    results.push({ name: svc.name, up, critical: svc.critical });
  }

  const allCriticalUp = results.filter(r => r.critical).every(r => r.up);
  const upCount = results.filter(r => r.up).length;

  // Heartbeat silencieux
  const heartbeat = `${ts} | ${upCount}/${results.length} UP | cycle ${cycleCount} | critical:${allCriticalUp ? 'OK' : 'DEGRADED'}\n`;
  appendFileSync(HEARTBEAT, heartbeat);

  if (cycleCount % 20 === 0) { // log console toutes les 10min
    console.log(`[VitalLoop] cycle ${cycleCount} — ${upCount}/${results.length} services UP`);
  }
}

// ─── Rapport quotidien 09h00 ─────────────────────────────────────────────────
async function sendDailyReport() {
  const lines = [];
  let total = 0, upTotal = 0;

  for (const [name, stats] of serviceStats) {
    const pct = stats.upCount + stats.downCount > 0
      ? Math.round(stats.upCount / (stats.upCount + stats.downCount) * 100)
      : 100;
    lines.push(`${pct >= 95 ? '✅' : pct >= 80 ? '⚠️' : '❌'} ${name}: ${pct}%`);
    total++;
    if (stats.lastStatus === 'up') upTotal++;
  }

  // Compter incidents
  let incidentCount = 0;
  if (existsSync(INCIDENTS)) {
    const today = new Date().toISOString().slice(0, 10);
    const lines2 = readFileSync(INCIDENTS, 'utf8').split('\n').filter(Boolean);
    incidentCount = lines2.filter(l => l.includes(today)).length;
  }

  const msg = `📊 *Jarvis Bilan 24h*\n\n${lines.join('\n')}\n\n` +
              `Services UP : ${upTotal}/${total}\n` +
              `Incidents : ${incidentCount}\n` +
              `Cycles : ${cycleCount}`;
  await sendTelegram(msg);
  console.log('[VitalLoop] Rapport quotidien envoyé');
}

// ─── Scheduler rapport 09h00 ─────────────────────────────────────────────────
function scheduleDailyReport() {
  const now = new Date();
  const next9am = new Date(now);
  next9am.setHours(9, 0, 0, 0);
  if (next9am <= now) next9am.setDate(next9am.getDate() + 1);
  const ms = next9am - now;
  setTimeout(() => {
    sendDailyReport();
    setInterval(sendDailyReport, 24 * 3600 * 1000); // puis toutes les 24h
  }, ms);
  console.log(`[VitalLoop] Rapport quotidien schedulé dans ${Math.round(ms/3600000)}h`);
}

// ─── Démarrage ────────────────────────────────────────────────────────────────
console.log('[VitalLoop] ✅ Démarrage — vérification toutes les 30s');
runChecks(); // immédiat au démarrage
const interval = setInterval(runChecks, 30_000);
scheduleDailyReport();

process.on('SIGINT',  () => { clearInterval(interval); console.log('[VitalLoop] Arrêt'); process.exit(0); });
process.on('SIGTERM', () => { clearInterval(interval); process.exit(0); });
