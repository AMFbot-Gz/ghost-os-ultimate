/**
 * dashboard/server.js — LaRuche HQ Dashboard Server
 * API REST + WebSocket — Port 8080
 */

import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import initSqlJs from "sql.js";
import dotenv from "dotenv";

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PORT = 8080;
const DB_PATH = join(ROOT, ".laruche/shadow-errors.db");

// sql.js — chargement async puis accès synchrone
const SQL = await initSqlJs();
const db = existsSync(DB_PATH)
  ? new SQL.Database(readFileSync(DB_PATH))
  : new SQL.Database();

// Helper drop-in pour remplacer better-sqlite3 .prepare().get() et .all()
function dbGet(sql, params = []) {
  try {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    if (stmt.step()) { const row = stmt.getAsObject(); stmt.free(); return row; }
    stmt.free(); return null;
  } catch { return null; }
}
function dbAll(sql, params = []) {
  try {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free(); return rows;
  } catch { return []; }
}

// Cache registry.json avec invalidation toutes les 30s
let _registryCache = null;
let _registryCacheTs = 0;
function getCachedRegistry() {
  if (_registryCache && Date.now() - _registryCacheTs < 30000) return _registryCache;
  try { _registryCache = JSON.parse(readFileSync(join(ROOT, ".laruche/registry.json"), "utf-8")); }
  catch { _registryCache = { skills: [] }; }
  _registryCacheTs = Date.now();
  return _registryCache;
}

// ─── HTTP Server + Router ─────────────────────────────────────────────────────
const server = createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Content-Type", "application/json");

  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  // GET /api/status
  if (url.pathname === "/api/status" && req.method === "GET") {
    try {
      const missions = dbGet("SELECT COUNT(*) as total FROM missions");
      res.writeHead(200);
      res.end(JSON.stringify({
        status: "online",
        version: "3.0.0",
        uptime: Math.floor(process.uptime()),
        missions_total: missions?.total || 0,
        timestamp: new Date().toISOString(),
      }));
    } catch (e) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // GET /api/missions
  if (url.pathname === "/api/missions" && req.method === "GET") {
    try {
      const missions = dbAll("SELECT * FROM missions ORDER BY id DESC LIMIT 50");
      res.writeHead(200);
      res.end(JSON.stringify({ missions }));
    } catch (e) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // GET /api/costs
  if (url.pathname === "/api/costs" && req.method === "GET") {
    try {
      const today = new Date().toISOString().split("T")[0];
      // Une seule requête au lieu de 2 SELECT séquentiels
      const row = dbGet(`
        SELECT
          SUM(CASE WHEN timestamp LIKE ? THEN cost_usd ELSE 0 END) as daily,
          SUM(cost_usd) as total
        FROM token_usage
      `, [`${today}%`]);
      res.writeHead(200);
      res.end(JSON.stringify({ daily: row?.daily || 0, total: row?.total || 0 }));
    } catch (e) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // GET /api/skills
  if (url.pathname === "/api/skills" && req.method === "GET") {
    res.writeHead(200);
    res.end(JSON.stringify(getCachedRegistry()));
    return;
  }

  // POST /api/command
  if (url.pathname === "/api/command" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try {
        const { command } = JSON.parse(body);
        // Relai vers queen.js via Telegram API
        if (process.env.TELEGRAM_BOT_TOKEN && process.env.ADMIN_TELEGRAM_ID) {
          fetch(
            `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: process.env.ADMIN_TELEGRAM_ID,
                text: command,
              }),
            }
          ).catch(() => {});
        }
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, command }));
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // POST /api/control
  if (url.pathname === "/api/control" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try {
        const { action } = JSON.parse(body);
        // Broadcast aux clients WS
        broadcast({ type: action === "KILL_ALL" ? "kill_all" : "resurrect" });
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, action }));
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // Serve dashboard frontend (fallback)
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(`<!DOCTYPE html>
<html>
<head><title>LaRuche HQ</title>
<style>
  body { background: #0D0D1A; color: #E0E0E0; font-family: monospace; padding: 20px; }
  h1 { color: #F5A623; }
  .card { background: #1A1A2E; border: 1px solid #7C3AED; border-radius: 8px; padding: 16px; margin: 12px 0; }
</style>
</head>
<body>
<h1>🐝 LaRuche HQ v3.0</h1>
<div class="card">Dashboard React en cours de build. API disponible sur /api/</div>
<div class="card">
  <strong>Endpoints:</strong><br>
  GET /api/status — État système<br>
  GET /api/missions — Historique missions<br>
  GET /api/costs — Coûts tokens<br>
  GET /api/skills — Skills disponibles<br>
  POST /api/command — Envoyer commande<br>
  POST /api/control — KILL_ALL / RESURRECT
</div>
</body>
</html>`);
});

// ─── WebSocket ─────────────────────────────────────────────────────────────────
const wss = new WebSocketServer({ server });
const clients = new Set();

// Singleton WebSocket proxy vers HUD — évite N connexions pour N clients dashboard
let hudProxy = null;

function getHudProxy() {
  if (hudProxy && hudProxy.readyState === WebSocket.OPEN) return hudProxy;
  hudProxy = new WebSocket("ws://localhost:9001");
  hudProxy.on("message", (data) => {
    // Diffuser à TOUS les clients dashboard connectés
    broadcast(JSON.parse(data.toString()));
  });
  hudProxy.on("close", () => { hudProxy = null; setTimeout(getHudProxy, 3000); });
  hudProxy.on("error", () => {});
  return hudProxy;
}
// Initialiser la connexion HUD au démarrage du serveur
getHudProxy();

wss.on("connection", (ws) => {
  clients.add(ws);
  ws.send(JSON.stringify({ type: "connected", ts: Date.now() }));
  ws.on("close", () => clients.delete(ws));
});

function broadcast(event) {
  const msg = JSON.stringify({ ...event, ts: Date.now() });
  clients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  });
}

server.listen(PORT, () => {
  console.log(`🐝 LaRuche Dashboard HQ: http://localhost:${PORT}`);
});
