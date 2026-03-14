/**
 * config.js — Centralized LaRuche config loader
 * Single import for all config: .laruche/config.json + env vars + LARUCHE_MODE
 */

import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// ─── LARUCHE_MODE profiles ────────────────────────────────────────────────────

const PROFILES = {
  low: {
    maxWorkers: 2,
    hudUpdateHz: 2,          // HUD WebSocket events per second
    dashboardCacheMs: 5000,  // Dashboard API cache TTL
    logLevel: "warn",
    ollamaModel: "llama3.2:3b",
    visionEnabled: false,    // Disable vision to save RAM
    streamingEnabled: false,
  },
  balanced: {
    maxWorkers: 5,
    hudUpdateHz: 5,
    dashboardCacheMs: 2000,
    logLevel: "info",
    ollamaModel: null,       // auto-detect
    visionEnabled: true,
    streamingEnabled: true,
  },
  high: {
    maxWorkers: 10,
    hudUpdateHz: 30,
    dashboardCacheMs: 500,
    logLevel: "debug",
    ollamaModel: null,       // auto-detect (largest available)
    visionEnabled: true,
    streamingEnabled: true,
  },
};

// ─── File config ──────────────────────────────────────────────────────────────

function loadFileConfig() {
  const configPath = join(ROOT, ".laruche/config.json");
  if (!existsSync(configPath)) return {};
  try { return JSON.parse(readFileSync(configPath, "utf-8")); }
  catch { return {}; }
}

// ─── Merged config ────────────────────────────────────────────────────────────

const MODE = (process.env.LARUCHE_MODE || "balanced").toLowerCase();
const profile = PROFILES[MODE] || PROFILES.balanced;
const fileConfig = loadFileConfig();

export const config = {
  // Identity
  version: "3.2.0",
  name: "LaRuche SINGULARITY",
  mode: MODE,

  // Merged from file + env
  ollamaHost: process.env.OLLAMA_HOST || fileConfig.ollamaHost || "http://localhost:11434",
  ollamaModel: process.env.OLLAMA_MODEL || profile.ollamaModel || fileConfig.textModel || "llama3.2:3b",
  visionModel: process.env.OLLAMA_MODEL_VISION || fileConfig.visionModel || "llava:7b",
  retinaScale: parseFloat(process.env.RETINA_SCALE || String(fileConfig.retinaScale || "2.0")),

  // Ports
  hudPort: parseInt(process.env.HUD_PORT || String(fileConfig.hudPort || "9001")),
  dashboardPort: parseInt(process.env.DASHBOARD_PORT || String(fileConfig.dashboardPort || "8080")),

  // Performance profile
  profile,
  maxWorkers: profile.maxWorkers,
  logLevel: process.env.LOG_LEVEL || profile.logLevel,
  streamingEnabled: profile.streamingEnabled,
  visionEnabled: profile.visionEnabled,

  // Limits
  costAlertUSD: parseFloat(process.env.COST_ALERT_USD || String(fileConfig.costAlertUSD || "2.00")),
  hitlTimeoutSec: parseInt(process.env.HITL_TIMEOUT_SECONDS || String(fileConfig.hitlTimeoutSec || "60")),
  ramLimitMB: parseInt(process.env.RAM_LIMIT_MB || String(fileConfig.ramLimitMB || "500")),

  // Auth
  telegramToken: process.env.TELEGRAM_BOT_TOKEN || "",
  adminId: process.env.ADMIN_TELEGRAM_ID || "",
};

export function getProfile() {
  return { mode: MODE, ...profile };
}

export function isConfigured() {
  return !!(config.telegramToken && config.adminId &&
    !config.telegramToken.includes("your_") &&
    config.adminId !== "your_telegram_user_id" &&
    config.adminId !== "");
}
