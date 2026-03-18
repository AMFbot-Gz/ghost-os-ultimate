/**
 * src/modes/standalone.js — Mode sans Telegram
 * LaRuche v3.2 — Standalone API Server
 *
 * Démarre un serveur HTTP Hono sur API_PORT (défaut 3000).
 * Tous les endpoints sont disponibles via REST.
 * Les mises à jour temps réel passent par le WebSocket HUD (port 9001).
 */

import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { createMissionsRoutes } from "../api/missions.js";
import { createMcpRoutes } from "../api/mcp_routes.js";
import { createMutationsRoutes } from "../api/mutations.js";
import { registerConfigRoutes } from "../api/config_routes.js";
import { registerHubRoutes } from "../hub/skillHub.js";
import { startCoeusLoop } from "../agents/coeus.js";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import eventBus from "../../core/events/event_bus.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "../../");

// URLs des 7 couches Python — port fixe défini par l'architecture
const LAYER_URLS = {
  queen_python: "http://localhost:8001/health",
  perception:   "http://localhost:8002/health",
  brain:        "http://localhost:8003/health",
  executor:     "http://localhost:8004/health",
  evolution:    "http://localhost:8005/health",
  memory:       "http://localhost:8006/health",
  mcp_bridge:   "http://localhost:8007/health",
};

/**
 * Vérifie l'état d'une couche Python via son endpoint /health.
 * Timeout de 2 secondes, retourne "OK" ou "DOWN".
 *
 * @param {string} url
 * @returns {Promise<string>}
 */
async function checkLayer(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
    return res.ok ? "OK" : `DOWN (HTTP ${res.status})`;
  } catch {
    return "DOWN";
  }
}

/**
 * Lit skills/registry.json et retourne le nombre de skills enregistrés.
 *
 * @returns {number}
 */
function countSkills() {
  try {
    const raw  = readFileSync(resolve(PROJECT_ROOT, "skills/registry.json"), "utf8");
    const data = JSON.parse(raw);
    // Supporte { skills: [...] } ou un tableau direct
    if (Array.isArray(data)) return data.length;
    if (Array.isArray(data.skills)) return data.skills.length;
    return 0;
  } catch {
    return -1; // Fichier absent ou invalide
  }
}

/**
 * Lance le serveur API standalone
 *
 * @param {{
 *   loadMissions: () => Object[],
 *   saveMission: (entry: Object) => void,
 *   runMission: (command: string, missionId: string) => Promise<string>,
 *   autoDetectRoles: () => Promise<Object>,
 *   broadcastHUD: (event: Object) => void,
 *   logger: import('winston').Logger,
 * }} deps
 * @returns {{ app: Hono, server: import('http').Server }}
 */
export function startStandaloneServer(deps) {
  const { logger } = deps;
  const port = parseInt(process.env.API_PORT || "3000", 10);

  const app = new Hono();

  // ─── CORS ──────────────────────────────────────────────────────────────────
  app.use("*", async (c, next) => {
    c.res.headers.set("Access-Control-Allow-Origin", process.env.CORS_ORIGIN || "*");
    c.res.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    c.res.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (c.req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: c.res.headers });
    }
    await next();
  });

  // ─── Auth Bearer — routes /api/* (sauf /api/health, /health, /mcp/health) ──
  // Routes publiques exclues : /api/health, /health, /mcp/health
  // Si CHIMERA_SECRET absent ou valeur de dev → warn et laisse passer (mode dev)
  const _BEARER_DEV_SECRET = 'pico-ruche-dev-secret-changez-moi';
  const bearerAuth = async (c, next) => {
    const path = c.req.path;
    // Routes publiques — jamais bloquées
    if (path === '/api/health' || path === '/health' || path === '/mcp/health') {
      await next();
      return;
    }
    const secret = process.env.CHIMERA_SECRET;
    // Pas de secret configuré ou valeur de dev → mode dev, pas de blocage
    if (!secret || secret === _BEARER_DEV_SECRET) {
      logger.warn('[Auth] CHIMERA_SECRET absent ou valeur de dev — routes /api/* non protégées');
      await next();
      return;
    }
    const auth = c.req.header('Authorization') || '';
    if (!auth.startsWith('Bearer ') || auth.slice(7) !== secret) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    await next();
  };

  // ─── Route /debug — Dashboard temps réel (publique, avant bearerAuth) ──────
  // Retourne un instantané complet de l'état Ghost OS : uptime, mémoire,
  // état des 7 couches Python, métriques event bus, nombre de skills.
  app.get("/debug", async (c) => {
    // Vérification parallèle de toutes les couches Python
    const layerEntries = await Promise.all(
      Object.entries(LAYER_URLS).map(async ([name, url]) => [name, await checkLayer(url)])
    );
    const layers = Object.fromEntries(layerEntries);

    // Métriques du bus d'événements (NeuralEventBus expose getMetrics())
    let event_bus_metrics = null;
    try {
      event_bus_metrics = eventBus.getMetrics?.() ?? null;
    } catch {
      event_bus_metrics = null;
    }

    return c.json({
      timestamp:          new Date().toISOString(),
      version:            "1.0.0",
      mode:               process.env.GHOST_OS_MODE || "standalone",
      uptime_s:           Math.round(process.uptime()),
      memory_mb:          Math.round(process.memoryUsage().heapUsed / 1024 / 1024 * 100) / 100,
      layers,
      event_bus_metrics,
      skills_count:       countSkills(),
    });
  });

  // Appliqué sur toutes les routes /api/*
  app.use('/api/*', bearerAuth);

  // ─── Routes missions ────────────────────────────────────────────────────────
  // Passe aussi healthMonitor, missionCache, eventBus pour l'enrichissement de /api/status
  createMissionsRoutes(app, deps);

  // ─── Routes MCP ─────────────────────────────────────────────────────────────
  // Endpoints directs vers les modules MCP Node.js (os-control, terminal, etc.)
  createMcpRoutes(app);
  createMutationsRoutes(app);
  registerConfigRoutes(app);

  // ─── Hub skills distribué ───────────────────────────────────────────────────
  // La Reine héberge le hub central. Les Ruches publient/pullent via ces routes.
  registerHubRoutes(app);

  // ─── Route racine ───────────────────────────────────────────────────────────
  app.get("/", (c) =>
    c.json({
      name: "LaRuche API",
      version: process.env.npm_package_version || "5.0.0",
      mode: "standalone",
      endpoints: [
        "POST /api/mission",
        "GET  /api/missions",
        "GET  /api/missions/:id",
        "POST /api/mission/:id/cancel",
        "GET  /api/queue",
        "GET  /api/status",
        "GET  /api/health",
        "GET  /api/system",
        "GET  /api/logs",
        "GET  /api/config",
        "GET  /api/agents",
        "GET  /api/agents/:name",
        "POST /api/agent",
        "POST /api/orchestrate",
        "GET  /api/subagents",
        "GET  /api/subagents/:id",
        "POST /api/subagents/:id/dispatch",
        "GET  /api/subagents/:id/stats",
        "GET  /api/skills",
        "POST /api/skills/:name/run",
        "DELETE /api/skills/:name",
        "GET  /api/memory",
        "DELETE /api/memory/forget",
        "GET  /api/memory/episodes",
        "POST /api/memory/episodes/search",
        "DELETE /api/memory/episodes/:id",
        "GET  /api/worldmodel/stats",
        "GET  /api/worldmodel/:appName",
        "DELETE /api/worldmodel/:appName",
        "GET  /api/perception/stats",
        "GET  /api/swarm/nodes",
        "GET  /api/swarm/stats",
        "GET  /api/goals",
        "POST /api/goals",
        "GET  /api/goals/schedule",
        "DELETE /api/goals/:id",
        "POST /api/simulate",
        "GET  /api/evolution/skills",
        "POST /api/evolution/trigger",
        "GET  /api/market/stats",
        "GET  /api/selfdev/analyze",
        "POST /api/search",
        "POST /api/process/restart",
        "GET  /mcp/health",
        "POST /mcp/os-control",
        "POST /mcp/terminal",
        "POST /mcp/vision",
        "POST /mcp/vault",
        "POST /mcp/rollback",
        "POST /mcp/skill-factory",
        "POST /mcp/janitor",
        "GET  /api/mutations/suggested",
        "POST /api/mutations/suggested",
        "GET  /api/mutations/stats",
        "POST /api/mutations/audit",
      ],
    })
  );

  // ─── 404 catch-all ─────────────────────────────────────────────────────────
  app.notFound((c) => c.json({ error: "Route introuvable" }, 404));

  // ─── Démarrage ──────────────────────────────────────────────────────────────
  const server = serve({ fetch: app.fetch, port }, () => {
    logger.info(`🌐 API Standalone: http://localhost:${port}`);
    logger.info(`📖 Endpoints: http://localhost:${port}/`);
  });

  // FIX — Gérer EADDRINUSE sans crash du processus
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      logger.warn(`⚠️  Port ${port} déjà utilisé — instance déjà active ? Continuer sans rebind.`);
    } else {
      logger.error(`Erreur serveur HTTP: ${err.message}`);
    }
  });

  startCoeusLoop();

  // ─── Voice continue (optionnel — activer avec VOICE_ENABLED=true) ─────────────
  if (process.env.VOICE_ENABLED === 'true') {
    import('../voice_continuous.js')
      .then(({ startVoiceContinuous }) => {
        startVoiceContinuous();
        console.info('[Standalone] 🎤 Voice continue activée');
      })
      .catch(err => console.warn(`[Standalone] Voice désactivée: ${err.message}`));
  }

  return { app, server };
}

/**
 * Vérifie si le mode standalone est activé
 */
export function isStandaloneMode() {
  return process.env.STANDALONE_MODE === "true" || process.env.STANDALONE_MODE === "1";
}
