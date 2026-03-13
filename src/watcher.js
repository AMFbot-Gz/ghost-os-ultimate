/**
 * watcher.js — Watchdog Agent LaRuche
 * Surveille queen.js toutes les 60s, force restart + alerte Telegram
 */

import { execSync } from "child_process";
import { createWriteStream, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const LOG_DIR = join(ROOT, ".laruche/logs");

mkdirSync(LOG_DIR, { recursive: true });

const logStream = createWriteStream(join(LOG_DIR, "watcher.log"), { flags: "a" });

function log(msg) {
  const line = `[${new Date().toISOString()}] [WATCHER] ${msg}\n`;
  process.stdout.write(line);
  logStream.write(line);
}

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
          text: `🛡️ *Watcher*: ${msg}`,
          parse_mode: "Markdown",
        }),
      }
    );
  } catch (e) {
    log(`Telegram alert failed: ${e.message}`);
  }
}

function isQueenAlive() {
  try {
    const result = execSync("pm2 jlist", { timeout: 5000 }).toString();
    const apps = JSON.parse(result);
    const queen = apps.find((a) => a.name === "laruche-queen");
    return queen?.pm2_env?.status === "online";
  } catch {
    return false;
  }
}

async function watchLoop() {
  log("Watchdog démarré — vérification toutes les 60s");

  while (true) {
    await new Promise((r) => setTimeout(r, 60000));

    if (!isQueenAlive()) {
      log("⚠️ queen.js ZOMBIE détecté — restart forcé");
      try {
        execSync("pm2 restart laruche-queen", { timeout: 15000 });
        log("✅ queen.js redémarré");
        await alertTelegram("queen.js zombie détecté et redémarré automatiquement.");
      } catch (e) {
        log(`❌ Restart échoué: ${e.message}`);
        await alertTelegram(`queen.js DOWN - restart échoué: ${e.message}`);
      }
    } else {
      log("✅ queen.js online");
    }
  }
}

watchLoop().catch((e) => {
  log(`Fatal: ${e.message}`);
  process.exit(1);
});
