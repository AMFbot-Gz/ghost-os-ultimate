/**
 * rollback_manager.js — Snapshots + Restauration
 * createSnapshot(), restore(), listSnapshots()
 */

import { mkdirSync, writeFileSync, readdirSync, readFileSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { execa } from "execa";
import dotenv from "dotenv";
import winston from "winston";

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const ROLLBACK_DIR = join(ROOT, ".laruche/rollback");

mkdirSync(ROLLBACK_DIR, { recursive: true });

const logger = winston.createLogger({
  level: "info",
  format: winston.format.simple(),
  transports: [new winston.transports.Console()],
});

export async function createSnapshot(missionId, reason) {
  const snapshotId = `${missionId}_${Date.now()}`;
  const snapshotDir = join(ROLLBACK_DIR, snapshotId);
  mkdirSync(snapshotDir, { recursive: true });

  try {
    await execa("rsync", [
      "-av", "--checksum",
      `${ROOT}/src/`, `${snapshotDir}/src/`,
      "--exclude=node_modules", "--exclude=.git",
    ], { reject: false });

    const manifest = {
      id: snapshotId,
      missionId,
      reason,
      timestamp: new Date().toISOString(),
    };
    writeFileSync(join(snapshotDir, "manifest.json"), JSON.stringify(manifest, null, 2));
    logger.info(`Snapshot créé: ${snapshotId}`);
    return snapshotDir;
  } catch (e) {
    logger.error(`createSnapshot: ${e.message}`);
    throw e;
  }
}

export async function restore(snapshotId) {
  const snapshotDir = join(ROLLBACK_DIR, snapshotId);
  await execa("rsync", [
    "-av", "--checksum",
    `${snapshotDir}/src/`, `${ROOT}/src/`,
  ], { reject: false });

  // Alerte Telegram
  if (process.env.TELEGRAM_BOT_TOKEN && process.env.ADMIN_TELEGRAM_ID) {
    await fetch(
      `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: process.env.ADMIN_TELEGRAM_ID,
          text: `⏪ Rollback effectué vers *${snapshotId}*. État restauré avec succès.`,
          parse_mode: "Markdown",
        }),
      }
    ).catch(() => {});
  }

  logger.info(`Rollback vers: ${snapshotId}`);
  return true;
}

export function listSnapshots() {
  return readdirSync(ROLLBACK_DIR)
    .filter((d) => { try { return statSync(join(ROLLBACK_DIR, d)).isDirectory(); } catch { return false; } })
    .map((d) => { try { return JSON.parse(readFileSync(join(ROLLBACK_DIR, d, "manifest.json"), "utf-8")); } catch { return null; } })
    .filter(Boolean)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
}
