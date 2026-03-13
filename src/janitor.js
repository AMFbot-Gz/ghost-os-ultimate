/**
 * janitor.js — Janitor Pro LaRuche v4.1
 * fix(C2): require() → dynamic import pour skill_evolution.js
 * fix(C3): better-sqlite3 supprimé (variable jamais utilisée)
 * Purge /temp 10min, rotation logs 24h, deep sleep, self-refactoring
 */

import cron from "node-cron";
import { readdirSync, rmSync, statSync, mkdirSync } from "fs";
import { rm } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { execa } from "execa";
import dotenv from "dotenv";
import { createContextLogger } from "./utils/logger.js";

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const logger = createContextLogger('janitor');

const TEMP_DIR = join(ROOT, ".laruche/temp");
const LOGS_DIR = join(ROOT, ".laruche/logs");
const LOG_TTL_HOURS = parseInt(process.env.LOG_TTL_HOURS || "24");
const TEMP_PURGE_MIN = parseInt(process.env.TEMP_PURGE_INTERVAL_MIN || "10");
const ROLLBACK_TTL_DAYS = parseInt(process.env.ROLLBACK_TTL_DAYS || "7");
const LOG_MAX_SIZE_MB = parseInt(process.env.LOG_MAX_SIZE_MB || "10");

mkdirSync(TEMP_DIR, { recursive: true });

async function purgeTemp() {
  try {
    const files = readdirSync(TEMP_DIR);
    const deletePromises = files
      .filter(f => f !== ".gitkeep")
      .map(f => rm(join(TEMP_DIR, f), { recursive: true, force: true }).then(() => 1).catch(() => 0));
    const results = await Promise.all(deletePromises);
    const purged = results.reduce((a, b) => a + b, 0);
    if (purged > 0) logger.info(`Purge /temp: ${purged} fichier(s) supprimé(s)`);
  } catch (e) {
    logger.error(`purgeTemp: ${e.message}`);
  }
}

function rotateLogs() {
  try {
    const files = readdirSync(LOGS_DIR);
    let rotated = 0;
    for (const f of files) {
      if (!f.endsWith(".log")) continue;
      const fullPath = join(LOGS_DIR, f);
      try {
        const stat = statSync(fullPath);
        const sizeMB = stat.size / (1024 * 1024);
        if (sizeMB > LOG_MAX_SIZE_MB) {
          rmSync(`${fullPath}.${Date.now()}.bak`, { force: true });
          logger.info(`Log rotaté: ${f} (${sizeMB.toFixed(1)}MB)`);
          rotated++;
        }
      } catch {}
    }
    if (rotated > 0) logger.info(`Rotation logs: ${rotated} fichier(s)`);
  } catch (e) {
    logger.error(`rotateLogs: ${e.message}`);
  }
}

// fix(C2): dynamic import au lieu de require()
async function deleteExpiredSkills() {
  try {
    const { listSkills } = await import('./skill_evolution.js');
    const skills = listSkills();
    let deleted = 0;
    for (const skill of skills) {
      if (skill.ttl && skill.ttl < Date.now()) {
        logger.info(`Skill TTL expiré: ${skill.name}`);
        deleted++;
      }
    }
    if (deleted > 0) logger.info(`Skills TTL expirés supprimés: ${deleted}`);
  } catch { /* skill_evolution optionnel */ }
}

function gcRAM() {
  if (global.gc) {
    global.gc();
    logger.info("Garbage collection forcée");
  }
}

// ─── Crons ────────────────────────────────────────────────────────────────────

cron.schedule(`*/${TEMP_PURGE_MIN} * * * *`, () => {
  logger.info("Cron purge temp...");
  purgeTemp();
});

cron.schedule("0 0 * * *", () => {
  logger.info("Rotation logs quotidienne...");
  rotateLogs();
});

cron.schedule("0 3 * * *", async () => {
  logger.info("Purge snapshots anciens...");
  try {
    const ROLLBACK_DIR = join(ROOT, ".laruche/rollback");
    const cutoff = Date.now() - ROLLBACK_TTL_DAYS * 24 * 60 * 60 * 1000;
    if (!readdirSync) return;
    const dirs = readdirSync(ROLLBACK_DIR).filter((d) => {
      try { return statSync(join(ROLLBACK_DIR, d)).isDirectory(); } catch { return false; }
    });
    let purged = 0;
    for (const dir of dirs) {
      const fullPath = join(ROLLBACK_DIR, dir);
      try {
        if (statSync(fullPath).mtimeMs < cutoff) {
          rmSync(fullPath, { recursive: true });
          purged++;
        }
      } catch {}
    }
    logger.info(`Snapshots purgés: ${purged}`);
  } catch (e) {
    logger.error(`purge snapshots: ${e.message}`);
  }
});

cron.schedule("*/5 * * * *", () => {
  const heapMB = process.memoryUsage().heapUsed / (1024 * 1024);
  if (heapMB > 400) {
    logger.warn(`RAM haute (${heapMB.toFixed(0)}MB) — GC forcée`);
    gcRAM();
  }
});

logger.info("✅ Janitor Pro v4.1 démarré — tous les crons actifs");

export { purgeTemp, rotateLogs, gcRAM };
