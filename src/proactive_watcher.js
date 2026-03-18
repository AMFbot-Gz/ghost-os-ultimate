/**
 * proactive_watcher.js — Watcher proactif LaRuche
 *
 * Surveille l'écran en arrière-plan et détecte des événements:
 * - Email urgent (si Gmail ouvert)
 * - Erreur système visible
 * - Notification importante
 * - Changement d'état significatif
 *
 * Envoie une alerte Telegram et propose une action.
 */

import { join, dirname } from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://localhost:11434";

// ─── Patterns de détection ────────────────────────────────────────────────────

const WATCH_PATTERNS = [
  {
    id: "urgent_email",
    trigger: /email urgent|message urgent|alerte|critical|URGENT/i,
    question: "Y a-t-il un email urgent ou un message important visible à l'écran?",
    action: "Ouvrir et lire l'email urgent",
  },
  {
    id: "system_error",
    trigger: /erreur|error|crash|failed|Exception|Traceback/i,
    question: "Y a-t-il une erreur système ou une exception visible?",
    action: "Analyser et corriger l'erreur",
  },
  {
    id: "notification",
    trigger: /notification|badge|alerte|\d+ unread|\d+ nouveaux/i,
    question: "Y a-t-il des notifications importantes ou des messages non lus?",
    action: "Traiter les notifications",
  },
];

// ─── Vision helper ────────────────────────────────────────────────────────────

async function quickVisionCheck(question) {
  try {
    const { execa } = await import("execa");
    const { stdout } = await execa("python3", [
      join(ROOT, "src/vision.py"),
      "--fn", "analyze_screen",
      "--args", JSON.stringify({ question }),
    ], { cwd: ROOT, timeout: 20000, reject: false });

    const result = JSON.parse(stdout);
    return result?.response || "";
  } catch {
    return "";
  }
}

// ─── Alerte Telegram ──────────────────────────────────────────────────────────

async function alertTelegram(message, action = null) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.ADMIN_TELEGRAM_ID;
  if (!token || !chatId) return;

  const text = action
    ? `👁 *LaRuche a détecté:*\n${message}\n\n_Répondre:_ \`oui\` pour que j'agisse, \`non\` pour ignorer.`
    : `👁 ${message}`;

  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
    });
  } catch {}
}

// ─── Boucle de surveillance ───────────────────────────────────────────────────

let _watcherActive = false;
let _lastPHash = "";
let _watchInterval = null;

// ─── Watcher Système (règles métier, sans vision) ─────────────────────────────

import { execSync } from "child_process";

// Timestamp de la dernière interaction Telegram
let _lastInteraction = Date.now();
let _emailUnreadSince = null; // timestamp depuis quand on a > 10 emails non lus
let _lastBriefingDate = null; // YYYY-MM-DD de la dernière fois qu'on a envoyé le briefing

// Mise à jour de la dernière interaction (appelé par jarvis-gateway)
export function touchInteraction() {
  _lastInteraction = Date.now();
}

async function checkDisk() {
  try {
    const out = execSync("df -h / | tail -1 | awk '{print $5}'", { encoding: "utf-8", timeout: 3000 });
    const pct = parseInt(out.trim()); // ex: "72%"
    if (pct >= 85) {
      await alertTelegram(
        `💾 Disque à **${pct}%** — espace critique (< 15% libre)`,
        "Nettoyer le disque (node_modules, .git objects, Ollama models non utilisés)"
      );
      return true;
    }
  } catch { /* non-fatal */ }
  return false;
}

async function checkPM2() {
  try {
    const out = execSync("pm2 jlist 2>/dev/null", { encoding: "utf-8", timeout: 5000 });
    const procs = JSON.parse(out);
    const errored = procs.filter(p => p.pm2_env?.status !== "online" && p.pm2_env?.status != null);
    if (errored.length > 0) {
      const names = errored.map(p => `\`${p.name}\` (${p.pm2_env.status})`).join(", ");
      await alertTelegram(
        `⚡ Processus PM2 en erreur : ${names}`,
        `Relancer : \`pm2 restart ${errored.map(p => p.name).join(" ")}\``
      );
      // Tentative de restart automatique
      for (const p of errored) {
        try { execSync(`pm2 restart ${p.name}`, { timeout: 5000 }); } catch {}
      }
      return true;
    }
  } catch { /* non-fatal */ }
  return false;
}

async function checkEmailCount() {
  try {
    const res = await fetch("http://localhost:3004/memory/recent?limit=20&tag=email", {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return false;
    const data = await res.json();
    const unread = (data.entries || []).filter(e => !e.read).length;

    if (unread >= 10) {
      if (!_emailUnreadSince) {
        _emailUnreadSince = Date.now();
        return false; // première détection — on attend 2h
      }
      const sinceMs = Date.now() - _emailUnreadSince;
      if (sinceMs >= 2 * 60 * 60 * 1000) { // 2 heures
        await alertTelegram(
          `📧 ${unread} emails non lus depuis ${Math.round(sinceMs / 3600000)}h`,
          "Trier les emails urgents"
        );
        _emailUnreadSince = null; // reset après alerte
        return true;
      }
    } else {
      _emailUnreadSince = null; // reset si moins de 10
    }
  } catch { /* non-fatal */ }
  return false;
}

async function checkMorningBriefing() {
  const now = new Date();
  const hour = now.getHours();
  const today = now.toISOString().slice(0, 10);

  if (hour === 8 && _lastBriefingDate !== today) {
    _lastBriefingDate = today;
    await alertTelegram(
      "🌅 Bonjour ! Voici votre briefing du matin.",
      "Envoyer le briefing complet (emails urgents + agenda + système)"
    );
    return true;
  }
  return false;
}

async function checkIdleTooLong() {
  const now = new Date();
  const hour = now.getHours();
  // Ne ping que pendant les heures de travail (8h-20h)
  if (hour < 8 || hour >= 20) return false;

  const idleMs = Date.now() - _lastInteraction;
  const SIX_HOURS = 6 * 60 * 60 * 1000;

  if (idleMs >= SIX_HOURS) {
    _lastInteraction = Date.now(); // reset pour éviter les pings en boucle
    await alertTelegram(
      `💬 Aucune interaction depuis ${Math.round(idleMs / 3600000)}h — tout va bien ?`,
      null
    );
    return true;
  }
  return false;
}

// ─── Boucle système (toutes les 5 min) ───────────────────────────────────────

let _systemInterval = null;

export function startSystemWatcher() {
  if (_systemInterval) return;
  console.log("[Watcher] Règles système démarrées (disk, pm2, emails, briefing, idle)");

  _systemInterval = setInterval(async () => {
    // Exécute les checks dans l'ordre, s'arrête à la première alerte envoyée
    // pour ne pas spammer Telegram
    await checkDisk()          ||
    await checkPM2()           ||
    await checkMorningBriefing() ||
    await checkEmailCount()    ||
    await checkIdleTooLong();
  }, 5 * 60 * 1000); // toutes les 5 minutes

  _systemInterval.unref?.();
}

export function stopSystemWatcher() {
  if (_systemInterval) {
    clearInterval(_systemInterval);
    _systemInterval = null;
  }
}

// ─── Vision watcher (écran) ───────────────────────────────────────────────────

export async function startProactiveWatcher(intervalMs = 60000) {
  if (_watcherActive) return;
  _watcherActive = true;

  const mode = process.env.LARUCHE_MODE || "balanced";
  const actualInterval = mode === "low" ? intervalMs * 5 : intervalMs;

  console.log(`[Watcher] Vision démarré — scan toutes les ${actualInterval / 1000}s`);

  _watchInterval = setInterval(async () => {
    if (!_watcherActive) return;

    try {
      const { execa } = await import("execa");
      const { stdout: b64 } = await execa("python3", ["-c", `
import pyautogui, base64, io
img = pyautogui.screenshot()
img_small = img.resize((200, 150))
buf = io.BytesIO()
img_small.save(buf, 'PNG')
print(base64.b64encode(buf.getvalue()).decode())
      `], { timeout: 5000, reject: false });

      if (!b64?.trim()) return;

      const currentHash = b64.slice(100, 120);
      if (currentHash === _lastPHash) return;
      _lastPHash = currentHash;

      const observation = await quickVisionCheck(
        "Y a-t-il une erreur, notification urgente, ou alerte importante visible à l'écran?"
      );
      if (!observation) return;

      for (const pattern of WATCH_PATTERNS) {
        if (pattern.trigger.test(observation)) {
          await alertTelegram(observation.slice(0, 200), pattern.action);
          break;
        }
      }
    } catch { /* non-fatal */ }
  }, actualInterval);
}

export function stopProactiveWatcher() {
  _watcherActive = false;
  if (_watchInterval) {
    clearInterval(_watchInterval);
    _watchInterval = null;
  }
  console.log("[Watcher] Vision arrêté");
}
