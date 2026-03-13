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

export async function startProactiveWatcher(intervalMs = 60000) {
  if (_watcherActive) return;
  _watcherActive = true;

  const mode = process.env.LARUCHE_MODE || "balanced";
  const actualInterval = mode === "low" ? intervalMs * 5 : intervalMs;

  console.log(`[Watcher] Démarré — scan toutes les ${actualInterval / 1000}s`);

  _watchInterval = setInterval(async () => {
    if (!_watcherActive) return;

    try {
      // Prendre screenshot via Python (rapide, sans bloquer)
      const { execa } = await import("execa");
      const { stdout: b64 } = await execa("python3", ["-c", `
import pyautogui, base64, io, hashlib
img = pyautogui.screenshot()
img_small = img.resize((200, 150))
buf = io.BytesIO()
img_small.save(buf, 'PNG')
data = buf.getvalue()
print(base64.b64encode(data).decode())
      `], { timeout: 5000, reject: false });

      if (!b64?.trim()) return;

      // pHash simple pour détecter les changements
      const currentHash = b64.slice(100, 120); // fingerprint simplifié
      if (currentHash === _lastPHash) return; // pas de changement
      _lastPHash = currentHash;

      // Analyse légère de l'écran (moondream est plus rapide que llava)
      const observation = await quickVisionCheck(
        "Décris brièvement ce qui est affiché. Y a-t-il une erreur, notification urgente, ou alerte importante visible?"
      );

      if (!observation) return;

      // Vérifier les patterns
      for (const pattern of WATCH_PATTERNS) {
        if (pattern.trigger.test(observation)) {
          await alertTelegram(observation.slice(0, 200), pattern.action);
          break; // une seule alerte à la fois
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
  console.log("[Watcher] Arrêté");
}
