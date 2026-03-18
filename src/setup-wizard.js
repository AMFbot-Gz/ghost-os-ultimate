#!/usr/bin/env node
/**
 * src/setup-wizard.js — Assistant de configuration interactif Jarvis
 *
 * Modes :
 *   --test-token <token>   Valide le format sans écrire de fichier (exit 0/1)
 *   --yes                  Mode non-interactif (CI), utilise les valeurs par défaut
 *   (aucun arg)            Mode interactif : readline, écrit .env
 *
 * Validation token Telegram : /^\d{8,10}:[A-Za-z0-9_-]{35,}$/
 */

import { createInterface } from 'readline';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = resolve(__dirname, '..');
const ENV_PATH  = resolve(ROOT, '.env');

const TELEGRAM_REGEX = /^\d{8,10}:[A-Za-z0-9_-]{35,}$/;

// ─── Helpers couleurs ─────────────────────────────────────────────────────────

const c = {
  reset : '\x1b[0m',
  bold  : '\x1b[1m',
  green : '\x1b[32m',
  red   : '\x1b[31m',
  yellow: '\x1b[33m',
  cyan  : '\x1b[36m',
  dim   : '\x1b[2m',
};
const ok    = (s) => console.log(`${c.green}✅ ${s}${c.reset}`);
const err   = (s) => console.error(`${c.red}❌ ${s}${c.reset}`);
const info  = (s) => console.log(`${c.cyan}ℹ  ${s}${c.reset}`);
const warn  = (s) => console.log(`${c.yellow}⚠  ${s}${c.reset}`);
const title = (s) => console.log(`\n${c.bold}${c.cyan}${s}${c.reset}\n`);

// ─── Validation token ─────────────────────────────────────────────────────────

/**
 * Valide le format d'un token Telegram.
 * @param {string} token
 * @returns {{ valid: boolean, reason?: string }}
 */
function validateTokenFormat(token) {
  if (!token || token.trim() === '') {
    return { valid: false, reason: 'Le token est vide.' };
  }
  const t = token.trim();
  if (!TELEGRAM_REGEX.test(t)) {
    return {
      valid: false,
      reason: `Format invalide — un token Telegram ressemble à : 123456789:ABCdefGHIjklMNOpqrSTUvwxYZ1234567890\n` +
              `   Vérifiez auprès de @BotFather sur Telegram.`,
    };
  }
  return { valid: true };
}

// ─── Test live via API Telegram ───────────────────────────────────────────────

async function testTokenLive(token) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
      signal: AbortSignal.timeout(8000),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      return {
        valid: false,
        reason: `L'API Telegram a refusé ce token : ${data.description || 'erreur inconnue'}`,
      };
    }
    return { valid: true, bot: data.result };
  } catch (e) {
    if (e.name === 'AbortError' || e.name === 'TimeoutError') {
      return { valid: false, reason: 'Timeout — impossible de joindre api.telegram.org (vérifiez votre connexion).' };
    }
    // Réseau absent → on accepte le token si le format est valide (mode offline)
    warn(`Test API Telegram impossible (${e.message}) — format accepté, vérification live ignorée.`);
    return { valid: true, offline: true };
  }
}

// ─── Mode --test-token ────────────────────────────────────────────────────────

async function modeTestToken(token) {
  const fmt = validateTokenFormat(token);
  if (!fmt.valid) {
    err(`Token Telegram invalide — ${fmt.reason}`);
    process.exit(1);
  }
  ok(`Format valide — le token respecte le format Telegram attendu.`);
  process.exit(0);
}

// ─── Mode interactif ──────────────────────────────────────────────────────────

function loadExistingEnv() {
  if (!existsSync(ENV_PATH)) return {};
  const lines = readFileSync(ENV_PATH, 'utf-8').split('\n');
  const vars = {};
  for (const line of lines) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) vars[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return vars;
}

function ask(rl, question, defaultVal = '') {
  return new Promise((resolve) => {
    const hint = defaultVal ? ` ${c.dim}[${defaultVal}]${c.reset}` : '';
    rl.question(`  ${question}${hint} : `, (answer) => {
      resolve(answer.trim() || defaultVal);
    });
  });
}

function writeEnv(vars) {
  const lines = [
    '# Jarvis v2.0 — Configuration générée par setup-wizard',
    `# Généré le ${new Date().toISOString()}`,
    '',
    '# ── Core ──────────────────────────────────────────────────────────────────',
    `STANDALONE_MODE=true`,
    `GHOST_OS_MODE=${vars.GHOST_OS_MODE || 'ultimate'}`,
    `NODE_ENV=${vars.NODE_ENV || 'production'}`,
    '',
    '# ── Telegram ───────────────────────────────────────────────────────────────',
    `TELEGRAM_BOT_TOKEN=${vars.TELEGRAM_BOT_TOKEN || ''}`,
    `ADMIN_TELEGRAM_ID=${vars.ADMIN_TELEGRAM_ID || ''}`,
    '',
    '# ── Ollama ─────────────────────────────────────────────────────────────────',
    `OLLAMA_HOST=${vars.OLLAMA_HOST || 'http://localhost:11434'}`,
    `OLLAMA_MODEL=${vars.OLLAMA_MODEL || 'llama3.2:3b'}`,
    '',
    '# ── APIs optionnelles ──────────────────────────────────────────────────────',
    `ANTHROPIC_API_KEY=${vars.ANTHROPIC_API_KEY || ''}`,
    '',
    '# ── Ports ──────────────────────────────────────────────────────────────────',
    `API_PORT=${vars.API_PORT || '3002'}`,
    `PICOCLAW_PORT=${vars.PICOCLAW_PORT || '8090'}`,
    '',
    '# ── Sécurité ───────────────────────────────────────────────────────────────',
    `CHIMERA_SECRET=${vars.CHIMERA_SECRET || generateSecret()}`,
    `HITL_TIMEOUT_SECONDS=${vars.HITL_TIMEOUT_SECONDS || '120'}`,
  ];
  writeFileSync(ENV_PATH, lines.join('\n') + '\n', 'utf-8');
}

function generateSecret(len = 32) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

async function modeInteractif(nonInteractive = false) {
  title('🤖 Jarvis v2.0 — Assistant de configuration');

  const existing = loadExistingEnv();
  const vars = { ...existing };

  if (!nonInteractive && existsSync(ENV_PATH)) {
    info(`.env existant détecté — les valeurs actuelles seront proposées par défaut.`);
    info(`Laissez vide pour conserver la valeur existante.\n`);
  }

  if (nonInteractive) {
    // Mode CI : vérifier que les vars critiques existent
    const missing = [];
    if (!vars.TELEGRAM_BOT_TOKEN) missing.push('TELEGRAM_BOT_TOKEN');
    if (!vars.ADMIN_TELEGRAM_ID)  missing.push('ADMIN_TELEGRAM_ID');
    if (missing.length) {
      err(`Mode --yes : variables manquantes dans .env : ${missing.join(', ')}`);
      err(`Lancez le wizard interactif d'abord : node src/setup-wizard.js`);
      process.exit(1);
    }
    // Compléter les valeurs par défaut manquantes
    vars.OLLAMA_HOST  = vars.OLLAMA_HOST  || 'http://localhost:11434';
    vars.OLLAMA_MODEL = vars.OLLAMA_MODEL || 'llama3.2:3b';
    vars.API_PORT     = vars.API_PORT     || '3002';
    vars.PICOCLAW_PORT = vars.PICOCLAW_PORT || '8090';
    vars.CHIMERA_SECRET = vars.CHIMERA_SECRET || generateSecret();
    vars.HITL_TIMEOUT_SECONDS = vars.HITL_TIMEOUT_SECONDS || '120';
    vars.GHOST_OS_MODE = vars.GHOST_OS_MODE || 'ultimate';
    vars.NODE_ENV = vars.NODE_ENV || 'production';

    writeEnv(vars);
    ok('.env mis à jour (mode non-interactif)');
    return;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    // ── 1. Token Telegram ──────────────────────────────────────────────────────
    console.log(`${c.bold}── 1/4 · Bot Telegram ─────────────────────────────${c.reset}`);
    info(`Obtenez votre token via @BotFather → /newbot`);

    let token = '';
    while (true) {
      token = await ask(rl, 'TELEGRAM_BOT_TOKEN', vars.TELEGRAM_BOT_TOKEN || '');
      const fmt = validateTokenFormat(token);
      if (!fmt.valid) {
        err(fmt.reason);
        continue;
      }
      info('Vérification du token auprès de Telegram…');
      const live = await testTokenLive(token);
      if (!live.valid) {
        err(live.reason);
        const retry = await ask(rl, 'Réessayer ? (o/n)', 'o');
        if (retry.toLowerCase() === 'n') break;
        continue;
      }
      if (live.bot) ok(`Bot validé : @${live.bot.username}`);
      else ok('Token accepté (mode offline)');
      vars.TELEGRAM_BOT_TOKEN = token;
      break;
    }

    // ── 2. Chat ID admin ───────────────────────────────────────────────────────
    console.log(`\n${c.bold}── 2/4 · Votre Telegram ID ─────────────────────────${c.reset}`);
    info(`Envoyez /start à @userinfobot pour obtenir votre ID.`);
    const chatId = await ask(rl, 'ADMIN_TELEGRAM_ID', vars.ADMIN_TELEGRAM_ID || '');
    if (chatId) vars.ADMIN_TELEGRAM_ID = chatId;

    // ── 3. Ollama ──────────────────────────────────────────────────────────────
    console.log(`\n${c.bold}── 3/4 · Ollama ────────────────────────────────────${c.reset}`);
    const ollamaHost = await ask(rl, 'OLLAMA_HOST', vars.OLLAMA_HOST || 'http://localhost:11434');
    vars.OLLAMA_HOST = ollamaHost;

    // Tenter de lister les modèles disponibles
    try {
      const res = await fetch(`${ollamaHost}/api/tags`, { signal: AbortSignal.timeout(3000) });
      const data = await res.json();
      const models = (data.models || []).map(m => m.name);
      if (models.length > 0) {
        info(`Modèles disponibles : ${models.slice(0, 5).join(', ')}${models.length > 5 ? '…' : ''}`);
      }
    } catch { /* Ollama peut être arrêté */ }

    const ollamaModel = await ask(rl, 'OLLAMA_MODEL', vars.OLLAMA_MODEL || 'llama3.2:3b');
    vars.OLLAMA_MODEL = ollamaModel;

    // ── 4. API key Anthropic (optionnel) ───────────────────────────────────────
    console.log(`\n${c.bold}── 4/4 · API Anthropic (optionnel) ─────────────────${c.reset}`);
    info('Laissez vide pour fonctionner 100% local (Ollama).');
    const anthropic = await ask(rl, 'ANTHROPIC_API_KEY', vars.ANTHROPIC_API_KEY || '');
    if (anthropic) vars.ANTHROPIC_API_KEY = anthropic;

    rl.close();
  } catch (e) {
    rl.close();
    throw e;
  }

  // ── Écriture .env ──────────────────────────────────────────────────────────
  writeEnv(vars);

  console.log('');
  ok(`.env écrit dans ${ENV_PATH}`);
  info(`Démarrez Jarvis avec : pm2 start ecosystem.config.cjs --env production`);
  info(`Ou via le CLI       : jarvis start`);
  console.log('');
}

// ─── Point d'entrée ───────────────────────────────────────────────────────────

const args = process.argv.slice(2);

if (args[0] === '--test-token') {
  const token = args[1] || '';
  if (!token) {
    err('Usage : node src/setup-wizard.js --test-token <votre_token>');
    process.exit(1);
  }
  modeTestToken(token);
} else if (args.includes('--yes')) {
  modeInteractif(true).catch((e) => {
    err(`Erreur : ${e.message}`);
    process.exit(1);
  });
} else {
  modeInteractif(false).catch((e) => {
    err(`Erreur : ${e.message}`);
    process.exit(1);
  });
}
