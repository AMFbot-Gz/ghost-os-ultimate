/**
 * src/jarvis-gateway.js — Jarvis Gateway Telegram Unique
 * Point d'entrée UNIQUE pour tous les messages Telegram.
 * dropPendingUpdates: true → élimine les 409 Conflict.
 * TELEGRAM_MODE=gateway doit être défini dans .env pour désactiver les autres bots.
 */
import { Telegraf } from 'telegraf';
import dotenv from 'dotenv';
import { createRequire } from 'module';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, writeFileSync, existsSync, createReadStream } from 'fs';
import {
  takeScreenshot, openApp, goToUrl, typeText, smartClick,
  extractAppName, extractUrl, decomposeCommand, executeSteps, runCUSession,
} from './mac-control.js';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_TELEGRAM_ID;
const API_PORT = process.env.API_PORT || '3002';

if (!TOKEN) {
  console.error('[Gateway] TELEGRAM_BOT_TOKEN manquant — arrêt');
  process.exit(1);
}

const bot = new Telegraf(TOKEN);

// ─── Learning Engine ────────────────────────────────────────────────────────

const FAST_PATHS_FILE = resolve(__dirname, '../data/fast-paths.json');

function loadFastPaths() {
  try {
    if (!existsSync(FAST_PATHS_FILE)) return {};
    return JSON.parse(readFileSync(FAST_PATHS_FILE, 'utf8'));
  } catch { return {}; }
}

function saveFastPaths(fp) {
  try { writeFileSync(FAST_PATHS_FILE, JSON.stringify(fp, null, 2)); } catch {}
}

// Normalise une commande en clé de fast-path
function normalizeCmd(cmd) {
  return cmd.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim().substring(0, 80);
}

// Apprend d'une mission réussie
async function learnFromMission(command, intentAgent, skillName, result, durationMs) {
  // 1. Stocker dans memory-hub :3004 (non-bloquant)
  fetch('http://localhost:3004/memory/store', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: command,
      result: (result?.result || '').substring(0, 200),
      source: 'telegram',
      tags: [intentAgent || 'brain', skillName || 'unknown'],
      duration: durationMs,
      success: result?.success !== false,
    }),
  }).catch(() => {});

  // 2. Si succès ET rapide → fast-path
  if (result?.success !== false && durationMs < 10000 && skillName) {
    const fp = loadFastPaths();
    const key = normalizeCmd(command);
    if (key.length > 5) {
      fp[key] = {
        skill: skillName,
        agent: intentAgent || 'brain',
        hits: (fp[key]?.hits || 0) + 1,
        lastSeen: new Date().toISOString(),
      };
      saveFastPaths(fp);
    }
  }
}

// ─── Intent Engine ────────────────────────────────────────────────────────────
// Analyse le texte naturel et mappe vers skill ou agent
const INTENT_PATTERNS = [
  // ── Actions Mac directes (bypass Queen) ──
  { pattern: /screenshot|capture\s*d.?écran|prends?\s+un\s+(screenshot|photo)|photographie\s+l.?écran/i, intent: 'take_screenshot', risk: false, direct: true },
  { pattern: /^(ouvre|lance|démarre|start|open)\s+\w/i,          intent: 'open_app',        risk: false, direct: true },
  { pattern: /va\s+sur|navigue\s+vers|ouvre\s+\w+\.(com|fr|io)/i, intent: 'goto_url',       risk: false, direct: true },
  { pattern: /^(tape|écris|saisis)\s+/i,                          intent: 'type_text',       risk: false, direct: true },
  { pattern: /^(clique|click)\s+(sur\s+)?/i,                      intent: 'smart_click',     risk: false, direct: true },
  // ── Commandes métier → Queen ──
  { pattern: /mail|email|gmail/i,                  intent: 'email-triage',           risk: false },
  { pattern: /agenda|calendar|events?/i,           intent: 'google-workspace',       risk: false },
  { pattern: /shopify|commande?s?|orders?|stock/i, intent: 'shopify-backend',        risk: false },
  { pattern: /shell|commande|run|execute/i,         intent: 'run_shell',              risk: true  },
  { pattern: /supprime|delete|rm |efface/i,         intent: 'run_shell',              risk: true  },
  { pattern: /status|état|health/i,                 intent: '_status',                risk: false },
  { pattern: /skills?/i,                            intent: '_list_skills',           risk: false },
  { pattern: /aide|help|\?$/i,                      intent: '_help',                  risk: false },
  { pattern: /\b(vente|crm|pipeline|appel de vente|prospect|lead|rapport ventes?|commercial)\b/i, agent: 'queen-node', skill: 'stitch-workflows' },
];

function detectIntent(text) {
  // Détection multi-étapes : 2+ actions séparées par virgules/puis/ensuite
  const parts = text.split(/,|\bpuis\b|\bensuite\b/i).map(s => s.trim()).filter(s => s.length > 2);
  if (parts.length >= 2) {
    const steps = decomposeCommand(text);
    if (steps.length >= 2) return { intent: 'multi_step', risk: false, direct: true };
  }

  for (const { pattern, intent, risk, direct } of INTENT_PATTERNS) {
    if (pattern.test(text)) return { intent, risk, direct: direct || false };
  }
  return { intent: 'mission', risk: false, direct: false }; // fallback → mission générale
}

// Charger les fast-paths appris et les injecter dans l'intent engine
const _learnedFastPaths = loadFastPaths();
const _highConfidencePaths = Object.entries(_learnedFastPaths)
  .filter(([, v]) => v.hits >= 3);
if (_highConfidencePaths.length > 0) {
  console.log(`[Gateway] ${_highConfidencePaths.length} fast-paths chargés depuis l'historique`);
}

// ─── HITL 120s ────────────────────────────────────────────────────────────────
const pendingHITL = new Map();

async function hitlConfirm(ctx, action, callbackFn) {
  const id = `hitl_${Date.now()}`;
  pendingHITL.set(id, { action, callbackFn, ts: Date.now() });
  await ctx.reply(
    `⚠️ *Action risquée détectée*\n\n\`${action}\`\n\nConfirmer ? (120s timeout)`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[
          { text: '✅ Confirmer', callback_data: `ok_${id}` },
          { text: '❌ Annuler',   callback_data: `no_${id}` },
        ]],
      },
    }
  );
  // Auto-expire après 120s
  setTimeout(() => {
    if (pendingHITL.has(id)) {
      pendingHITL.delete(id);
      ctx.reply(`⏱ HITL expiré (120s) — action annulée : \`${action}\``, { parse_mode: 'Markdown' });
    }
  }, 120_000);
}

bot.on('callback_query', async (ctx) => {
  const data = ctx.callbackQuery.data;
  if (data.startsWith('ok_') || data.startsWith('no_')) {
    const id = data.slice(3);
    const entry = pendingHITL.get(id);
    if (!entry) return ctx.answerCbQuery('Expiré');
    pendingHITL.delete(id);
    if (data.startsWith('ok_')) {
      await ctx.answerCbQuery('✅ Confirmé');
      await entry.callbackFn();
    } else {
      await ctx.answerCbQuery('❌ Annulé');
      await ctx.reply('Action annulée.');
    }
  }
});

// ─── Appel API Queen ──────────────────────────────────────────────────────────
async function callQueenMission(command) {
  const res = await fetch(`http://localhost:${API_PORT}/api/mission`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command, priority: 3 }),
    signal: AbortSignal.timeout(90_000),
  });
  return res.json();
}

// ─── Handlers ─────────────────────────────────────────────────────────────────
bot.start((ctx) => ctx.reply(
  '🤖 *Jarvis Gateway actif*\n\nEnvoie une commande en langage naturel.\nExemples :\n• "prends un screenshot"\n• "status des agents"\n• "liste mes emails urgents"\n• "ouvre Safari"',
  { parse_mode: 'Markdown' }
));

bot.on('text', async (ctx) => {
  // Sécurité : seulement l'admin
  if (ADMIN_ID && String(ctx.from.id) !== String(ADMIN_ID)) {
    return ctx.reply('❌ Non autorisé');
  }

  const text = ctx.message.text;
  const { intent, risk, direct } = detectIntent(text);

  // Commandes internes
  if (intent === '_status') {
    try {
      const res = await fetch(`http://localhost:${API_PORT}/debug`, { signal: AbortSignal.timeout(5000) });
      const d = await res.json();
      const layers = Object.entries(d.layers || {}).map(([k, v]) => `${v === 'OK' ? '✅' : '❌'} ${k}`).join('\n');
      return ctx.reply(`*Jarvis Status*\nUptime: ${d.uptime_s}s\nSkills: ${d.skills_count}\n\n${layers}`, { parse_mode: 'Markdown' });
    } catch (e) {
      return ctx.reply(`❌ Queen inaccessible : ${e.message}`);
    }
  }

  if (intent === '_list_skills') {
    try {
      const reg = JSON.parse(readFileSync(resolve(PROJECT_ROOT, 'skills/registry.json'), 'utf8'));
      const list = reg.skills.map(s => `• ${s.name}`).join('\n');
      return ctx.reply(`*Skills disponibles (${reg.skills.length})*\n${list}`, { parse_mode: 'Markdown' });
    } catch {
      return ctx.reply('❌ Registry inaccessible');
    }
  }

  if (intent === '_help') {
    return ctx.reply(
      '*Jarvis — Commandes naturelles*\n\n' +
      '🖥 Screenshot, clic, frappe\n📧 Emails, agenda Google\n🛒 Shopify orders/stock\n' +
      '🖥 Status, skills\n⚡ Mission : tout autre texte → Queen IA',
      { parse_mode: 'Markdown' }
    );
  }

  // Action risquée → HITL
  if (risk) {
    return hitlConfirm(ctx, text, async () => {
      try {
        const result = await callQueenMission(text);
        await sendMissionReport(ctx, text, result, null, intent);
      } catch (e) {
        ctx.reply(`❌ Erreur mission : ${e.message}`);
      }
    });
  }

  // ── Actions directes Mac (bypass Queen) ──────────────────────────────────
  if (direct) {
    await ctx.sendChatAction('typing');
    const t0 = Date.now();
    await executeMacAction(ctx, intent, text, t0);
    return;
  }

  // Mission normale → Queen
  await ctx.sendChatAction('typing');
  const t0 = Date.now();
  try {
    const result = await callQueenMission(text);
    await sendMissionReport(ctx, text, result, Date.now() - t0, intent);
  } catch (e) {
    await ctx.reply(`❌ Erreur : ${e.message}`);
  }
});

// ─── Envoi de screenshot sur Telegram ────────────────────────────────────────

async function sendScreenshotToTelegram(ctx, screenshotPath, caption = '') {
  try {
    await ctx.replyWithPhoto(
      { source: createReadStream(screenshotPath) },
      { caption: caption || '📸 Screenshot' },
    );
  } catch (e) {
    await ctx.reply(`⚠️ Screenshot pris mais envoi échoué : ${e.message}\nChemin : \`${screenshotPath}\``, { parse_mode: 'Markdown' });
  }
}

// ─── Exécution directe d'actions Mac ─────────────────────────────────────────

async function executeMacAction(ctx, intent, text, t0) {
  try {
    switch (intent) {

      // ── Screenshot ─────────────────────────────────────────────────────────
      case 'take_screenshot': {
        const ss = await takeScreenshot();
        const dur = ((Date.now() - t0) / 1000).toFixed(1);
        if (ss.error) {
          await ctx.reply(`❌ Screenshot échoué : ${ss.error}`);
        } else {
          await sendScreenshotToTelegram(ctx, ss.path, `📸 Screenshot (${dur}s) — ${ss.width}×${ss.height}`);
        }
        break;
      }

      // ── Ouvrir une app ─────────────────────────────────────────────────────
      case 'open_app': {
        const appName = extractAppName(text);
        const res = await openApp(appName);
        const dur = ((Date.now() - t0) / 1000).toFixed(1);
        await ctx.reply(`${res.success ? '✅' : '❌'} ${res.message || res.error}\n⏱ ${dur}s\n🔧 mac-control/open_app`);
        break;
      }

      // ── Aller sur une URL ──────────────────────────────────────────────────
      case 'goto_url': {
        const url = extractUrl(text);
        if (!url) { await ctx.reply(`❌ URL non reconnue dans : "${text}"`); break; }
        const res = await goToUrl(url);
        const dur = ((Date.now() - t0) / 1000).toFixed(1);
        // Prendre un screenshot après navigation
        await ctx.reply(`${res.success ? '✅' : '❌'} ${res.message || res.error}\n⏱ ${dur}s`);
        if (res.success) {
          await new Promise(r => setTimeout(r, 1500));
          const ss = await takeScreenshot();
          if (!ss.error) await sendScreenshotToTelegram(ctx, ss.path, `🌐 ${url}`);
        }
        break;
      }

      // ── Taper du texte ─────────────────────────────────────────────────────
      case 'type_text': {
        const match = text.match(/(?:tape|écris|saisis)\s+(.+)/i);
        const toType = match ? match[1] : text;
        const res = await typeText(toType);
        const dur = ((Date.now() - t0) / 1000).toFixed(1);
        await ctx.reply(`${res.success ? '✅' : '❌'} ${res.message}\n⏱ ${dur}s\n🔧 mac-control/type_text`);
        break;
      }

      // ── Cliquer sur un élément ─────────────────────────────────────────────
      case 'smart_click': {
        const match = text.match(/(?:clique|click)(?:\s+sur)?\s+(.+)/i);
        const query = match ? match[1] : text;
        const res = await smartClick(query);
        const dur = ((Date.now() - t0) / 1000).toFixed(1);
        await ctx.reply(`${res.success ? '✅' : '❌'} ${res.message || res.error}\n⏱ ${dur}s\n🔧 mac-control/smart_click`);
        break;
      }

      // ── Multi-étapes ───────────────────────────────────────────────────────
      case 'multi_step': {
        const steps = decomposeCommand(text);
        await ctx.reply(`🔄 *${steps.length} étapes détectées*\n${steps.map((s, i) => `${i+1}. ${s.raw}`).join('\n')}`, { parse_mode: 'Markdown' });

        const { results, lastScreenshotPath } = await executeSteps(steps);
        const dur = ((Date.now() - t0) / 1000).toFixed(1);

        const summary = results.map(r => `${r.ok ? '✅' : '❌'} ${r.message}`).join('\n');
        await ctx.reply(`*Mission multi-étapes* (${dur}s)\n\n${summary}`, { parse_mode: 'Markdown' });

        if (lastScreenshotPath) {
          await sendScreenshotToTelegram(ctx, lastScreenshotPath, '📸 Résultat final');
        }
        break;
      }

      default:
        await ctx.reply(`❓ Intent direct inconnu : ${intent}`);
    }

    // Learning
    learnFromMission(text, intent, intent, { success: true }, Date.now() - t0).catch(() => {});

  } catch (e) {
    await ctx.reply(`❌ Erreur Mac : ${e.message}`);
    console.error(`[Gateway] executeMacAction error:`, e);
  }
}

// ─── Rapport de mission structuré ─────────────────────────────────────────────
async function sendMissionReport(ctx, command, result, duration_ms, intentObj) {
  const status = result?.status === 'completed' ? '✅' : result?.status === 'failed' ? '❌' : '⏳';
  const dur = duration_ms ? ` (${(duration_ms/1000).toFixed(1)}s)` : '';
  const output = result?.output || result?.result || result?.summary || JSON.stringify(result).slice(0, 300);
  await ctx.reply(
    `${status} *Mission${dur}*\n\`${command.slice(0, 80)}\`\n\n${output}`,
    { parse_mode: 'Markdown' }
  );

  // Learning non-bloquant (stockage mémoire + fast-path si succès rapide)
  learnFromMission(
    command,
    intentObj?.intent || null,   // l'intent détecté (ex: 'mission', 'take_screenshot')
    null,                         // skill name non connu à ce niveau
    result,
    duration_ms
  ).catch(() => {});
}

// ─── Démarrage ────────────────────────────────────────────────────────────────
// Nettoie d'abord le webhook/updates en attente pour éviter 409
async function start() {
  try {
    await fetch(`https://api.telegram.org/bot${TOKEN}/deleteWebhook?drop_pending_updates=true`);
    console.log('[Gateway] Webhook supprimé + pending updates droppés');
  } catch (e) {
    console.warn('[Gateway] deleteWebhook warning:', e.message);
  }

  bot.launch({ dropPendingUpdates: true });
  console.log(`[Gateway] ✅ Jarvis Gateway démarré — bot actif, API sur :${API_PORT}`);
}

start();

process.once('SIGINT',  () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
