/**
 * voice_continuous.js — Écoute vocale continue avec Whisper
 *
 * Écoute en permanence le microphone.
 * Détecte le mot-clé "LaRuche" (ou "laruche", "la ruche").
 * Transcrit la commande qui suit et l'envoie au pipeline.
 */

import { spawn } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const KEYWORD = process.env.VOICE_KEYWORD || "laruche";

// ─── Alerte Telegram ──────────────────────────────────────────────────────────

async function sendToTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.ADMIN_TELEGRAM_ID;
  if (!token || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: `🎤 ${text}` }),
    });
  } catch {}
}

// ─── Pipeline voix ─────────────────────────────────────────────────────────────

async function processVoiceCommand(transcript) {
  console.log(`[Voice] Transcrit: "${transcript}"`);

  // Détecter le mot-clé
  const lower = transcript.toLowerCase();
  const keywordIdx = lower.indexOf(KEYWORD.toLowerCase());
  if (keywordIdx === -1) return; // pas de mot-clé

  // Extraire la commande après le mot-clé
  const command = transcript.slice(keywordIdx + KEYWORD.length).trim();
  if (!command || command.length < 3) return;

  console.log(`[Voice] Commande: "${command}"`);
  await sendToTelegram(`Commande vocale: "${command}"`);

  // Envoyer au pipeline
  try {
    const { runIntentPipeline, isComputerUseIntent } = await import("./agents/intentPipeline.js");
    const { ask } = await import("./model_router.js");

    if (isComputerUseIntent(command)) {
      const result = await runIntentPipeline(command, {
        hudFn: (e) => console.log(`[Voice→HUD] ${e.type}: ${e.task || e.thought || ""}`),
      });
      await sendToTelegram(result.success ? `✅ ${result.goal}` : `⚠️ ${result.error}`);
    } else {
      const result = await ask(command, { role: "worker", timeout: 30000 });
      await sendToTelegram(result.text?.slice(0, 500) || "Pas de réponse");
    }
  } catch (e) {
    await sendToTelegram(`❌ Erreur: ${e.message}`);
  }
}

// ─── Démarrage écoute continue ────────────────────────────────────────────────

export function startVoiceContinuous() {
  const pythonScript = `
import asyncio
import sys
sys.path.insert(0, '${ROOT}/src')

async def main():
    from voice_command import listen
    import json

    print("[Voice] Écoute active — mot-clé: ${KEYWORD}")
    print("[Voice] Parlez après avoir dit '${KEYWORD}...'")

    while True:
        try:
            text = await listen(max_seconds=8.0, language="fr")
            if text and len(text.strip()) > 2:
                print(json.dumps({"transcript": text.strip()}))
                sys.stdout.flush()
        except Exception as e:
            print(json.dumps({"error": str(e)}))
            sys.stdout.flush()
            await asyncio.sleep(1)

asyncio.run(main())
`;

  const py = spawn("python3", ["-c", pythonScript], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });

  py.stdout.on("data", (data) => {
    const lines = data.toString().split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        if (obj.transcript) {
          processVoiceCommand(obj.transcript).catch(console.error);
        }
      } catch { /* raw output */ }
    }
  });

  py.stderr.on("data", (data) => {
    const msg = data.toString().trim();
    if (msg && !msg.includes("UserWarning") && !msg.includes("FutureWarning")) {
      console.error(`[Voice stderr] ${msg}`);
    }
  });

  py.on("exit", (code) => {
    console.log(`[Voice] Process exit (${code}) — redémarrage dans 5s`);
    setTimeout(startVoiceContinuous, 5000);
  });

  console.log(`[Voice] Démarré — mot-clé: "${KEYWORD}"`);
  return py;
}
