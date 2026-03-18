/**
 * src/memory-hub.js — Jarvis Memory Hub Unifié
 * API REST sur :3004
 *
 * Sources :
 *   - data/mission_log.jsonl   (ghost-os missions log)
 *   - data/episodes.jsonl      (épisodes appris)
 *   - ChromaDB ruche-corps     (si ~/Projects/ruche-corps disponible)
 *
 * Routes :
 *   GET  /health
 *   GET  /memory/stats
 *   GET  /memory/episodes?limit=10&offset=0
 *   POST /memory/store { text, source, tags[] }
 *   GET  /memory/search?q=<query>&limit=5
 *   GET  /memory/missions?limit=10
 */

import { createServer } from 'http';
import { readFileSync, appendFileSync, existsSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
dotenv.config();

const __dirname   = dirname(fileURLToPath(import.meta.url));
const ROOT        = resolve(__dirname, '..');
const DATA_DIR    = resolve(ROOT, 'data');
const EPISODES    = resolve(DATA_DIR, 'episodes.jsonl');
const MISSION_LOG = resolve(DATA_DIR, 'mission_log.jsonl');
const RUCHE_MEM   = resolve(process.env.HOME, 'Projects/ruche-corps/memory');
const PORT        = parseInt(process.env.MEMORY_HUB_PORT || '3004');

// Init fichiers si absents
if (!existsSync(EPISODES)) writeFileSync(EPISODES, '');

// ─── ChromaDB ruche-corps (optionnel) ────────────────────────────────────────
let chromaClient = null;
let chromaCollection = null;

async function initChroma() {
  if (!existsSync(RUCHE_MEM)) {
    console.log('[MemoryHub] ChromaDB ruche-corps absent — mode episodes.jsonl uniquement');
    return false;
  }
  try {
    const { ChromaClient } = await import('chromadb');
    chromaClient = new ChromaClient({ path: 'http://localhost:8000' });
    await chromaClient.heartbeat();
    chromaCollection = await chromaClient.getOrCreateCollection({ name: 'jarvis_memory' });
    console.log('[MemoryHub] ChromaDB ruche-corps connecté');
    return true;
  } catch (e) {
    console.log(`[MemoryHub] ChromaDB optionnel — non disponible (${e.message}) — mode jsonl`);
    chromaClient = null;
    return false;
  }
}

// ─── Lecture episodes.jsonl ───────────────────────────────────────────────────
function readEpisodes(limit = 50, offset = 0) {
  if (!existsSync(EPISODES)) return [];
  const lines = readFileSync(EPISODES, 'utf8').split('\n').filter(Boolean);
  return lines
    .slice(Math.max(0, lines.length - offset - limit), lines.length - offset)
    .reverse()
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

function readMissionLog(limit = 50) {
  if (!existsSync(MISSION_LOG)) return [];
  const lines = readFileSync(MISSION_LOG, 'utf8').split('\n').filter(Boolean);
  return lines.slice(-limit).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean).reverse();
}

// ─── Recherche simple (keyword matching) ─────────────────────────────────────
function searchEpisodes(query, limit = 5) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const episodes = readEpisodes(200);
  const scored = episodes.map(ep => {
    const text = JSON.stringify(ep).toLowerCase();
    const score = terms.reduce((s, t) => s + (text.includes(t) ? 1 : 0), 0);
    return { ...ep, _score: score };
  }).filter(ep => ep._score > 0).sort((a, b) => b._score - a._score);
  return scored.slice(0, limit);
}

// ─── Store episode ────────────────────────────────────────────────────────────
function storeEpisode(entry) {
  const episode = {
    id:  `ep_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    ts:  new Date().toISOString(),
    ...entry,
  };
  appendFileSync(EPISODES, JSON.stringify(episode) + '\n');

  // Store aussi dans ChromaDB si disponible
  if (chromaCollection) {
    chromaCollection.add({
      documents: [entry.text || JSON.stringify(entry)],
      ids: [episode.id],
      metadatas: [{ source: entry.source || 'unknown', ts: episode.ts, tags: (entry.tags || []).join(',') }],
    }).catch(() => {}); // non-bloquant
  }

  return episode;
}

// ─── Stats ───────────────────────────────────────────────────────────────────
function getStats() {
  const episodeCount = existsSync(EPISODES)
    ? readFileSync(EPISODES, 'utf8').split('\n').filter(Boolean).length
    : 0;
  const missionCount = existsSync(MISSION_LOG)
    ? readFileSync(MISSION_LOG, 'utf8').split('\n').filter(Boolean).length
    : 0;
  return {
    episodes:     episodeCount,
    missions:     missionCount,
    chroma:       chromaClient !== null,
    ruche_memory: existsSync(RUCHE_MEM),
    port:         PORT,
  };
}

// ─── Routeur HTTP ─────────────────────────────────────────────────────────────
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch { resolve({}); } });
    req.on('error', reject);
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // GET /health
  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200);
    res.end(JSON.stringify({ ok: true, service: 'memory-hub', port: PORT }));
    return;
  }

  // GET /memory/stats
  if (req.method === 'GET' && url.pathname === '/memory/stats') {
    res.writeHead(200);
    res.end(JSON.stringify(getStats()));
    return;
  }

  // GET /memory/episodes
  if (req.method === 'GET' && url.pathname === '/memory/episodes') {
    const limit  = parseInt(url.searchParams.get('limit')  || '10');
    const offset = parseInt(url.searchParams.get('offset') || '0');
    const episodes = readEpisodes(limit, offset);
    res.writeHead(200);
    res.end(JSON.stringify({ episodes, count: episodes.length }));
    return;
  }

  // GET /memory/missions
  if (req.method === 'GET' && url.pathname === '/memory/missions') {
    const limit = parseInt(url.searchParams.get('limit') || '10');
    const missions = readMissionLog(limit);
    res.writeHead(200);
    res.end(JSON.stringify({ missions, count: missions.length }));
    return;
  }

  // GET /memory/search?q=...
  if (req.method === 'GET' && url.pathname === '/memory/search') {
    const q = url.searchParams.get('q') || '';
    const limit = parseInt(url.searchParams.get('limit') || '5');
    if (!q) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'Paramètre q requis' }));
      return;
    }
    const results = searchEpisodes(q, limit);
    res.writeHead(200);
    res.end(JSON.stringify({ results, count: results.length, query: q }));
    return;
  }

  // POST /memory/store
  if (req.method === 'POST' && url.pathname === '/memory/store') {
    const body = await parseBody(req);
    if (!body.text && !body.command) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'Champ text requis' }));
      return;
    }
    const episode = storeEpisode(body);
    res.writeHead(201);
    res.end(JSON.stringify({ ok: true, id: episode.id }));
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({
    error: 'Route introuvable',
    routes: [
      'GET /health',
      'GET /memory/stats',
      'GET /memory/episodes?limit=10&offset=0',
      'GET /memory/missions?limit=10',
      'GET /memory/search?q=<query>&limit=5',
      'POST /memory/store { text, source, tags[] }',
    ],
  }));
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.warn(`[MemoryHub] Port ${PORT} déjà utilisé`);
  } else {
    console.error(`[MemoryHub] Erreur: ${err.message}`);
  }
});

// ─── Démarrage ────────────────────────────────────────────────────────────────
server.listen(PORT, async () => {
  console.log(`[MemoryHub] Démarré sur :${PORT}`);
  await initChroma();
  const stats = getStats();
  console.log(`[MemoryHub] Stats: ${stats.episodes} épisodes, ${stats.missions} missions, chroma:${stats.chroma}`);
});

process.on('SIGINT',  () => { server.close(); process.exit(0); });
process.on('SIGTERM', () => { server.close(); process.exit(0); });
