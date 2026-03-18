/**
 * src/voice-handler.js — Transcription vocale Telegram via Whisper
 *
 * Reçoit un message vocal Telegram (file_id ogg/opus),
 * le télécharge, le transcrit localement via whisper (Python),
 * retourne le texte en français.
 *
 * Si Whisper n'est pas installé : retourne null (graceful degradation).
 * Installation : pip3 install openai-whisper
 *
 * Modèle utilisé : tiny (rapide, ~150MB) — changeable via WHISPER_MODEL=base
 */

import { execSync, spawnSync } from 'child_process';
import { writeFileSync, existsSync, unlinkSync } from 'fs';

const WHISPER_MODEL = process.env.WHISPER_MODEL || 'tiny';

// ─── Détection Whisper ────────────────────────────────────────────────────────

let _whisperAvailable = null;

function isWhisperAvailable() {
  if (_whisperAvailable !== null) return _whisperAvailable;
  try {
    execSync('python3 -c "import whisper"', { timeout: 5000, stdio: 'pipe' });
    _whisperAvailable = true;
  } catch {
    _whisperAvailable = false;
  }
  return _whisperAvailable;
}

// ─── Téléchargement fichier Telegram ─────────────────────────────────────────

async function downloadTelegramFile(fileId, botToken) {
  const infoRes = await fetch(
    `https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`,
    { signal: AbortSignal.timeout(8000) }
  );
  const info = await infoRes.json();
  const filePath = info?.result?.file_path;
  if (!filePath) throw new Error('Fichier vocal introuvable sur Telegram');

  const audioRes = await fetch(
    `https://api.telegram.org/file/bot${botToken}/${filePath}`,
    { signal: AbortSignal.timeout(15000) }
  );
  if (!audioRes.ok) throw new Error(`Téléchargement vocal HTTP ${audioRes.status}`);

  const buffer = Buffer.from(await audioRes.arrayBuffer());
  const tmpPath = `/tmp/jarvis-voice-${Date.now()}.ogg`;
  writeFileSync(tmpPath, buffer);
  return tmpPath;
}

// ─── Transcription Whisper ────────────────────────────────────────────────────

function transcribeWithWhisper(audioPath) {
  const result = spawnSync('python3', ['-c', `
import whisper, sys
model = whisper.load_model('${WHISPER_MODEL}')
result = model.transcribe('${audioPath}', language='fr', fp16=False)
print(result['text'].strip())
`], { encoding: 'utf-8', timeout: 45000 });

  if (result.error) throw new Error(`Whisper erreur : ${result.error.message}`);
  if (result.status !== 0) throw new Error(`Whisper stderr : ${(result.stderr || '').slice(0, 200)}`);
  return (result.stdout || '').trim();
}

// ─── API publique ─────────────────────────────────────────────────────────────

/**
 * Transcrit un message vocal Telegram en texte.
 *
 * @param {string} fileId - ID fichier Telegram (message.voice.file_id)
 * @param {string} botToken - TELEGRAM_BOT_TOKEN
 * @returns {Promise<string|null>} texte transcrit, ou null si Whisper absent/erreur
 */
export async function transcribeVoice(fileId, botToken) {
  if (!isWhisperAvailable()) {
    console.warn('[Voice] Whisper non installé — pip3 install openai-whisper');
    return null;
  }

  let tmpPath = null;
  try {
    tmpPath = await downloadTelegramFile(fileId, botToken);
    const text = transcribeWithWhisper(tmpPath);
    return text || null;
  } catch (e) {
    console.warn('[Voice] Transcription échouée:', e.message);
    return null;
  } finally {
    if (tmpPath && existsSync(tmpPath)) {
      try { unlinkSync(tmpPath); } catch {}
    }
  }
}

/**
 * Indique si Whisper est disponible.
 * @returns {boolean}
 */
export function isVoiceAvailable() {
  return isWhisperAvailable();
}
