/**
 * src/moltbot-bridge.js — Moltbot ↔ Jarvis Bridge
 * Webhook REST sur :3003 — reçoit les messages de tous canaux moltbot
 * et les passe à Queen Node.js (:3002) comme missions.
 *
 * Format entrant  : POST /moltbot/webhook { channel, from, text, messageId? }
 * Format sortant  : { response, missionId, duration, skill }
 *
 * Canaux supportés : whatsapp | discord | slack | signal | telegram | test
 */

import { createServer } from 'http';
import { readFileSync } from 'fs';
import dotenv from 'dotenv';
dotenv.config();

const PORT       = parseInt(process.env.MOLTBOT_BRIDGE_PORT || '3003');
const QUEEN_URL  = `http://localhost:${process.env.API_PORT || '3002'}`;

// ─── Intent Engine (identique jarvis-gateway) ──────────────────────────────
const INTENT_PATTERNS = [
  { pattern: /screenshot|capture|écran/i,         skill: 'take_screenshot' },
  { pattern: /mail|email|gmail/i,                  skill: 'email-triage' },
  { pattern: /shopify|commande|order|stock/i,      skill: 'shopify-backend' },
  { pattern: /google|agenda|calendar/i,            skill: 'google-workspace' },
  { pattern: /status|état|health/i,               skill: '_status' },
  { pattern: /skills?/i,                           skill: '_list_skills' },
];

function detectSkill(text) {
  for (const { pattern, skill } of INTENT_PATTERNS) {
    if (pattern.test(text)) return skill;
  }
  return null;
}

// ─── Appel Queen Mission ────────────────────────────────────────────────────
async function executeMission(text, channel, from) {
  const t0 = Date.now();
  try {
    const res = await fetch(`${QUEEN_URL}/api/mission`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: text, priority: 3, source: `moltbot:${channel}`, from }),
      signal: AbortSignal.timeout(90_000),
    });
    const data = await res.json();
    const duration = Date.now() - t0;
    return {
      response: data.output || data.result || data.summary || `Mission ${data.status || 'exécutée'}`,
      missionId: data.mission_id || data.id || null,
      duration,
      skill: detectSkill(text),
      status: data.status || 'unknown',
    };
  } catch (err) {
    return {
      response: `❌ Erreur Jarvis : ${err.message}`,
      missionId: null,
      duration: Date.now() - t0,
      skill: null,
      status: 'error',
    };
  }
}

// ─── Status interne ─────────────────────────────────────────────────────────
async function getStatus() {
  try {
    const res = await fetch(`${QUEEN_URL}/debug`, { signal: AbortSignal.timeout(5000) });
    const d = await res.json();
    const up = Object.values(d.layers || {}).filter(v => v === 'OK').length;
    const total = Object.keys(d.layers || {}).length;
    return `🤖 Jarvis UP — ${up}/${total} agents, ${d.skills_count} skills, uptime ${d.uptime_s}s`;
  } catch {
    return '❌ Jarvis inaccessible';
  }
}

// ─── Routeur HTTP minimal ───────────────────────────────────────────────────
const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // GET /health
  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200);
    res.end(JSON.stringify({ ok: true, service: 'moltbot-bridge', port: PORT, ts: Date.now() }));
    return;
  }

  // GET /status
  if (req.method === 'GET' && url.pathname === '/status') {
    const status = await getStatus();
    res.writeHead(200);
    res.end(JSON.stringify({ status }));
    return;
  }

  // POST /moltbot/webhook
  if (req.method === 'POST' && url.pathname === '/moltbot/webhook') {
    let body = '';
    for await (const chunk of req) body += chunk;
    let payload;
    try { payload = JSON.parse(body); } catch {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'Invalid JSON' }));
      return;
    }

    const { channel = 'unknown', from = 'anonymous', text = '', messageId } = payload;

    if (!text.trim()) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'text requis' }));
      return;
    }

    // Commande status rapide
    if (/^(status|état)$/i.test(text.trim())) {
      const status = await getStatus();
      res.writeHead(200);
      res.end(JSON.stringify({ response: status, missionId: null, duration: 0, skill: '_status' }));
      return;
    }

    console.log(`[Bridge] ${channel}:${from} → "${text.slice(0, 80)}"`);
    const result = await executeMission(text, channel, from);
    console.log(`[Bridge] → ${result.status} (${result.duration}ms)`);

    res.writeHead(200);
    res.end(JSON.stringify(result));
    return;
  }

  // 404
  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Route introuvable', available: ['GET /health', 'GET /status', 'POST /moltbot/webhook'] }));
});

server.listen(PORT, () => {
  console.log(`[Moltbot Bridge] ✅ Listening on :${PORT} — bridging all channels → Jarvis Queen :${process.env.API_PORT || 3002}`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.warn(`[Bridge] Port ${PORT} déjà utilisé — instance déjà active`);
  } else {
    console.error(`[Bridge] Erreur: ${err.message}`);
  }
});

export { executeMission };
