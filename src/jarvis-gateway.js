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
import { readFileSync } from 'fs';

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

// ─── Intent Engine ────────────────────────────────────────────────────────────
// Analyse le texte naturel et mappe vers skill ou agent
const INTENT_PATTERNS = [
  { pattern: /screenshot|capture|écran/i,         intent: 'take_screenshot',        risk: false },
  { pattern: /mail|email|gmail/i,                  intent: 'email-triage',           risk: false },
  { pattern: /google|agenda|calendar|events?/i,    intent: 'google-workspace',       risk: false },
  { pattern: /shopify|commande?s?|orders?|stock/i, intent: 'shopify-backend',        risk: false },
  { pattern: /ouvre|lance|open|app/i,              intent: 'open_app',               risk: false },
  { pattern: /clique|click/i,                      intent: 'smart_click',            risk: false },
  { pattern: /tape|écris|type/i,                   intent: 'type_text',              risk: false },
  { pattern: /shell|commande|run|execute/i,         intent: 'run_shell',              risk: true  },
  { pattern: /supprime|delete|rm |efface/i,         intent: 'run_shell',              risk: true  },
  { pattern: /status|état|health/i,                 intent: '_status',                risk: false },
  { pattern: /skills?/i,                            intent: '_list_skills',           risk: false },
  { pattern: /aide|help|\?$/i,                      intent: '_help',                  risk: false },
];

function detectIntent(text) {
  for (const { pattern, intent, risk } of INTENT_PATTERNS) {
    if (pattern.test(text)) return { intent, risk };
  }
  return { intent: 'mission', risk: false }; // fallback → mission générale
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
  const { intent, risk } = detectIntent(text);

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
      const typing = ctx.sendChatAction('typing');
      try {
        const result = await callQueenMission(text);
        await sendMissionReport(ctx, text, result);
      } catch (e) {
        ctx.reply(`❌ Erreur mission : ${e.message}`);
      }
    });
  }

  // Mission normale → Queen
  await ctx.sendChatAction('typing');
  const t0 = Date.now();
  try {
    const result = await callQueenMission(text);
    await sendMissionReport(ctx, text, result, Date.now() - t0);
  } catch (e) {
    await ctx.reply(`❌ Erreur : ${e.message}`);
  }
});

// ─── Rapport de mission structuré ─────────────────────────────────────────────
async function sendMissionReport(ctx, command, result, duration_ms) {
  const status = result?.status === 'completed' ? '✅' : result?.status === 'failed' ? '❌' : '⏳';
  const dur = duration_ms ? ` (${(duration_ms/1000).toFixed(1)}s)` : '';
  const output = result?.output || result?.result || result?.summary || JSON.stringify(result).slice(0, 300);
  await ctx.reply(
    `${status} *Mission${dur}*\n\`${command.slice(0, 80)}\`\n\n${output}`,
    { parse_mode: 'Markdown' }
  );

  // Store en mémoire (non-bloquant)
  fetch('http://localhost:3004/memory/store', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: `${command} → ${output.slice(0, 200)}`,
      source: 'telegram',
      tags: [result?.status || 'unknown'],
    }),
  }).catch(() => {});
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
