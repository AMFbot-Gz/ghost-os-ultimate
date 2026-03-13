/**
 * token_sentinel.js — Token Sentinel LaRuche
 * Tracking coûts API temps réel + alertes Telegram
 */

import Database from "better-sqlite3";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const db = new Database(join(ROOT, ".laruche/shadow-errors.db"));

const COST_ALERT_USD = parseFloat(process.env.COST_ALERT_USD || "2.00");

// Cache coûts journaliers (TTL 30s)
let _dailyCostCache = null;
let _dailyCostTs = 0;

// Coûts approximatifs par million de tokens
const MODEL_COSTS = {
  "llama3.2:3b": { in: 0, out: 0 },      // Local = gratuit
  "llava:7b": { in: 0, out: 0 },          // Local = gratuit
  "claude-sonnet-4": { in: 3, out: 15 },  // $/M tokens
  "gemini-ultra": { in: 0.07, out: 0.21 },
  "kimi-2.5": { in: 0.14, out: 0.28 },
};

async function alertTelegram(msg) {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.ADMIN_TELEGRAM_ID) return;
  try {
    await fetch(
      `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: process.env.ADMIN_TELEGRAM_ID,
          text: `💰 *Token Sentinel*: ${msg}`,
          parse_mode: "Markdown",
        }),
      }
    );
  } catch {}
}

export function trackUsage(model, tokensIn, tokensOut, missionId = null) {
  _dailyCostCache = null; // Invalider cache
  const costs = MODEL_COSTS[model] || { in: 0, out: 0 };
  const cost = (tokensIn / 1_000_000) * costs.in + (tokensOut / 1_000_000) * costs.out;

  db.prepare(
    "INSERT INTO token_usage (timestamp, mission_id, model, tokens_in, tokens_out, cost_usd) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(new Date().toISOString(), missionId, model, tokensIn, tokensOut, cost);

  return cost;
}

export function getMissionCost(missionId) {
  const row = db
    .prepare("SELECT SUM(cost_usd) as total FROM token_usage WHERE mission_id = ?")
    .get(missionId);
  return row?.total || 0;
}

export function getDailyCost() {
  if (_dailyCostCache !== null && Date.now() - _dailyCostTs < 30000) {
    return _dailyCostCache;
  }
  const today = new Date().toISOString().split("T")[0];
  try {
    const row = db
      .prepare("SELECT SUM(cost_usd) as total FROM token_usage WHERE timestamp LIKE ?")
      .get(`${today}%`);
    _dailyCostCache = row?.total || 0;
  } catch {
    _dailyCostCache = 0;
  }
  _dailyCostTs = Date.now();
  return _dailyCostCache;
}

export async function checkAlert(missionCost) {
  if (missionCost >= COST_ALERT_USD) {
    await alertTelegram(
      `⚠️ Mission estimée à $${missionCost.toFixed(3)} — seuil $${COST_ALERT_USD} atteint. HITL requis.`
    );
    return true;
  }
  return false;
}

export function getStats() {
  return {
    daily_cost: getDailyCost(),
    total_missions: db.prepare("SELECT COUNT(*) as c FROM missions").get()?.c || 0,
    alert_threshold: COST_ALERT_USD,
  };
}
