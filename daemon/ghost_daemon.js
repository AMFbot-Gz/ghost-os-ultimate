#!/usr/bin/env node
/**
 * daemon/ghost_daemon.js — Ghost Computer-Use Daemon
 *
 * Petit serveur HTTP à déployer sur chaque machine à contrôler.
 * Expose un API standard que le Ghost Core appelle via DaemonClientAdapter.
 *
 * Routes :
 *   GET  /health      → ping + machine info
 *   POST /observe     → arbre d'accessibilité + état écran
 *   POST /act         → exécute une action (click, type, open_app…)
 *   POST /screenshot  → capture PNG (base64 ou chemin)
 *   POST /wait        → attend une condition
 *
 * Configuration (.env) :
 *   MACHINE_ID=mac-local
 *   DAEMON_PORT=9000
 *   DAEMON_SECRET=  (vide = pas d'auth, acceptable en LAN)
 *   GHOST_CORE_URL=http://192.168.1.1:3000  (optionnel — pour enregistrement auto)
 *   DAEMON_IMPL=macos  (macos | linux | windows | stub)
 *
 * Usage :
 *   node daemon/ghost_daemon.js
 *   DAEMON_IMPL=stub node daemon/ghost_daemon.js   (test sans vrai OS)
 *
 * Docker :
 *   docker build -t ghost-daemon -f daemon/Dockerfile .
 *   docker run -p 9000:9000 -e MACHINE_ID=my-mac ghost-daemon
 */

import http            from 'http';
import { URL }         from 'url';
import { createRequire } from 'module';
import os              from 'os';
import { existsSync }  from 'fs';
import path            from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Config ──────────────────────────────────────────────────────────────────

// Charger .env si présent (sans dépendance dotenv)
const envFile = path.join(__dirname, '../.env');
if (existsSync(envFile)) {
  const lines = (await import('fs')).readFileSync(envFile, 'utf8').split('\n');
  for (const line of lines) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const MACHINE_ID   = process.env.MACHINE_ID   || os.hostname();
const PORT         = parseInt(process.env.DAEMON_PORT || '9000', 10);
const SECRET       = process.env.DAEMON_SECRET || '';
const IMPL         = process.env.DAEMON_IMPL   || detectImpl();
const LOG_LEVEL    = process.env.LOG_LEVEL     || 'info';

function detectImpl() {
  switch (process.platform) {
    case 'darwin':  return 'macos';
    case 'linux':   return 'linux';
    case 'win32':   return 'windows';
    default:        return 'stub';
  }
}

// ─── Logger ──────────────────────────────────────────────────────────────────

const log = {
  info:  (...a) => console.log( `[${ts()}] INFO `, ...a),
  warn:  (...a) => console.warn(`[${ts()}] WARN `, ...a),
  error: (...a) => console.error(`[${ts()}] ERROR`, ...a),
};
function ts() { return new Date().toISOString().slice(11, 23); }

// ─── Implémentations OS ───────────────────────────────────────────────────────

/**
 * Chaque impl expose :
 *   observe(options)       → ObserveData
 *   act(action)            → ActionData
 *   screenshot(options)    → ScreenshotData
 *   waitFor(cond, timeout) → WaitData
 */

// ── macOS (wraps les couches Python Ghost OS locales) ─────────────────────────
const macos = {
  _pythonBase: process.env.PYTHON_PERCEPTION_URL || 'http://127.0.0.1:8002',
  _executorBase: process.env.PYTHON_EXECUTOR_URL || 'http://127.0.0.1:8004',

  async observe(options = {}) {
    // Appelle la couche perception :8002
    const res = await jsonPost(`${this._pythonBase}/observe`, {
      app:   options.app   || null,
      roles: options.roles || null,
    });
    return res;
  },

  async act(action) {
    const { type, params = {} } = action;
    // Toutes les actions → couche executor :8004
    const body = { action: type, ...params };
    return jsonPost(`${this._executorBase}/execute`, body);
  },

  async screenshot(options = {}) {
    const res = await jsonPost(`${this._pythonBase}/screenshot`, {
      path: options.path || null,
    });
    return res;
  },

  async waitFor(condition, timeoutMs = 10000) {
    // Simple polling via observe
    const deadline = Date.now() + timeoutMs;
    const interval = condition.params?.interval_ms || 500;
    while (Date.now() < deadline) {
      const obs = await this.observe({ app: condition.params?.app });
      if (obs.success && obs.data?.elements) {
        const found = obs.data.elements.some(el =>
          (el.title || '').toLowerCase().includes((condition.params?.query || '').toLowerCase())
        );
        if (found) return { success: true, data: { found: true, elapsed_ms: Date.now() - (deadline - timeoutMs) } };
      }
      await sleep(interval);
    }
    return { success: false, error: 'waitFor timeout', data: { found: false } };
  },
};

// ── Linux (xdotool + AT-SPI2 + scrot) ────────────────────────────────────────
const linux = {
  // Point d'extension — à implémenter avec xdotool / AT-SPI2 / atspi-python
  async observe(_opts) {
    return { success: false, error: 'Linux observe: non implémenté (brancher AT-SPI2)' };
  },
  async act(action) {
    const { type, params = {} } = action;
    // Exemple : xdotool type pour type_text
    if (type === 'type_text') {
      return exec_cmd(['xdotool', 'type', '--delay', '50', params.text || '']);
    }
    if (type === 'click') {
      return exec_cmd(['xdotool', 'mousemove', String(params.x), String(params.y), 'click', '1']);
    }
    if (type === 'press_key') {
      const key = mapKey_linux(params.key);
      return exec_cmd(['xdotool', 'key', key]);
    }
    if (type === 'screenshot') {
      return exec_cmd(['scrot', params.path || '/tmp/ghost_shot.png']);
    }
    return { success: false, error: `Linux act: "${type}" non implémenté` };
  },
  async screenshot(opts) {
    const path = opts.path || '/tmp/ghost_shot.png';
    return exec_cmd(['scrot', path]);
  },
  async waitFor(cond, timeout) {
    return { success: false, error: 'Linux waitFor: non implémenté' };
  },
};

// ── Windows (pyautogui / UIA) ─────────────────────────────────────────────────
const windows = {
  // Point d'extension — à implémenter avec pyautogui ou UIAutomation Python
  async observe(_opts) {
    return { success: false, error: 'Windows observe: non implémenté (brancher UIA)' };
  },
  async act(action) {
    const { type, params = {} } = action;
    // pyautogui via subprocess Python
    if (type === 'type_text') {
      return exec_cmd(['python', '-c', `import pyautogui; pyautogui.write(${JSON.stringify(params.text)}, interval=0.05)`]);
    }
    if (type === 'click') {
      return exec_cmd(['python', '-c', `import pyautogui; pyautogui.click(${params.x}, ${params.y})`]);
    }
    return { success: false, error: `Windows act: "${type}" non implémenté` };
  },
  async screenshot(opts) {
    const path = opts.path || 'C:\\Temp\\ghost_shot.png';
    return exec_cmd(['python', '-c', `import pyautogui; pyautogui.screenshot(${JSON.stringify(path)})`]);
  },
  async waitFor(_cond, _timeout) {
    return { success: false, error: 'Windows waitFor: non implémenté' };
  },
};

// ── Stub (tests / CI) ─────────────────────────────────────────────────────────
const stub = {
  async observe(_opts) {
    return {
      success: true,
      data: {
        app: 'StubApp', elements: [
          { role: 'button', title: 'OK', x: 100, y: 200, width: 80, height: 30, confidence: 1.0 },
          { role: 'textField', title: 'Search', x: 50, y: 50, width: 300, height: 30, confidence: 1.0 },
        ],
        elements_count: 2,
        resolution: { width: 1920, height: 1080 },
      },
    };
  },
  async act(action) {
    log.info(`STUB act: ${action.type}`, action.params);
    return { success: true, data: { stub: true, action: action.type } };
  },
  async screenshot(opts) {
    return { success: true, data: { path: opts.path || '/tmp/stub.png', stub: true } };
  },
  async waitFor(cond, _timeout) {
    return { success: true, data: { found: true, condition: cond.type, stub: true } };
  },
};

// Sélection de l'implémentation
const IMPLS = { macos, linux, windows, stub };
const impl  = IMPLS[IMPL] || stub;
log.info(`Daemon impl: ${IMPL} (machine: ${MACHINE_ID})`);

// ─── Serveur HTTP ─────────────────────────────────────────────────────────────

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end',  () => {
      try { resolve(JSON.parse(data || '{}')); }
      catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(json) });
  res.end(json);
}

function authOk(req) {
  if (!SECRET) return true; // Pas de secret → tout passe (LAN)
  const h = req.headers['x-ghost-secret'] || '';
  return h === SECRET;
}

async function handleRequest(req, res) {
  const url    = new URL(req.url, `http://localhost:${PORT}`);
  const path_  = url.pathname;
  const method = req.method.toUpperCase();

  // Auth
  if (!authOk(req)) return send(res, 401, { success: false, error: 'Unauthorized' });

  // Routes
  if (method === 'GET' && path_ === '/health') {
    return send(res, 200, {
      success:     true,
      machine_id:  MACHINE_ID,
      platform:    process.platform,
      impl:        IMPL,
      uptime_s:    Math.floor(process.uptime()),
      memory_mb:   Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      timestamp:   new Date().toISOString(),
      version:     '1.0.0',
    });
  }

  if (method === 'POST' && path_ === '/observe') {
    const body    = await readBody(req);
    const t0      = Date.now();
    const result  = await impl.observe(body.options || {});
    return send(res, 200, { ...result, machine_id: MACHINE_ID, duration_ms: Date.now() - t0 });
  }

  if (method === 'POST' && path_ === '/act') {
    const body   = await readBody(req);
    const action = body.action;
    if (!action?.type) return send(res, 400, { success: false, error: 'action.type requis' });
    const t0     = Date.now();
    log.info(`act: ${action.type}`, JSON.stringify(action.params || {}));
    const result = await impl.act(action);
    return send(res, 200, { ...result, machine_id: MACHINE_ID, duration_ms: Date.now() - t0 });
  }

  if (method === 'POST' && path_ === '/screenshot') {
    const body   = await readBody(req);
    const t0     = Date.now();
    const result = await impl.screenshot(body.options || {});
    return send(res, 200, { ...result, machine_id: MACHINE_ID, duration_ms: Date.now() - t0 });
  }

  if (method === 'POST' && path_ === '/wait') {
    const body      = await readBody(req);
    const condition = body.condition;
    const timeout   = body.timeout_ms || 10000;
    if (!condition) return send(res, 400, { success: false, error: 'condition requis' });
    const t0     = Date.now();
    const result = await impl.waitFor(condition, timeout);
    return send(res, 200, { ...result, machine_id: MACHINE_ID, duration_ms: Date.now() - t0 });
  }

  return send(res, 404, { success: false, error: `Route inconnue: ${method} ${path_}` });
}

// ─── Utils ────────────────────────────────────────────────────────────────────

async function jsonPost(url, body) {
  try {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    const res   = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
      signal:  ctrl.signal,
    });
    clearTimeout(timer);
    return res.json();
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function exec_cmd(args) {
  const { execFileSync } = await import('child_process');
  try {
    const stdout = execFileSync(args[0], args.slice(1), { timeout: 15000 }).toString().trim();
    return { success: true, data: { stdout } };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function mapKey_linux(key) {
  const map = { Return: 'Return', Escape: 'Escape', Tab: 'Tab', Space: 'space', 'Cmd+C': 'ctrl+c', 'Cmd+V': 'ctrl+v' };
  return map[key] || key.toLowerCase();
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Auto-enregistrement auprès du Ghost Core ──────────────────────────────────

async function registerWithCore() {
  const coreUrl = process.env.GHOST_CORE_URL;
  if (!coreUrl) return;
  try {
    const res = await fetch(`${coreUrl}/api/machines/register`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.CHIMERA_SECRET || ''}` },
      body:    JSON.stringify({
        machine_id: MACHINE_ID,
        platform:   process.platform,
        daemon_url: `http://${os.hostname()}:${PORT}`,
        daemon_port: PORT,
      }),
    });
    if (res.ok) log.info(`Enregistré auprès du Core: ${coreUrl}`);
    else        log.warn(`Enregistrement Core échoué: ${res.status}`);
  } catch (err) {
    log.warn(`Core inaccessible (${coreUrl}): ${err.message}`);
  }
}

// ─── Démarrage ────────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  try {
    await handleRequest(req, res);
  } catch (err) {
    log.error('Erreur handler:', err.message);
    send(res, 500, { success: false, error: err.message });
  }
});

server.listen(PORT, '0.0.0.0', async () => {
  log.info(`Ghost Daemon démarré`);
  log.info(`  machine_id : ${MACHINE_ID}`);
  log.info(`  impl       : ${IMPL}`);
  log.info(`  port       : ${PORT}`);
  log.info(`  auth       : ${SECRET ? 'oui (X-Ghost-Secret)' : 'non (LAN mode)'}`);
  log.info(`  Endpoints  : GET /health | POST /observe | POST /act | POST /screenshot | POST /wait`);
  await registerWithCore();
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    log.error(`Port ${PORT} déjà utilisé. Changez DAEMON_PORT.`);
  } else {
    log.error('Serveur:', err.message);
  }
  process.exit(1);
});

process.on('SIGTERM', () => { server.close(); process.exit(0); });
process.on('SIGINT',  () => { server.close(); process.exit(0); });
