/**
 * Self-Repair Engine — Ghost OS Ultimate
 * Surveille les erreurs PM2 et applique des patches automatiques via le brain LLM.
 */

import pm2 from 'pm2';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config();

// ─── Constantes ───────────────────────────────────────────────────────────────

const PROTECTED_FILES = [
  '.env',
  'ecosystem.config.js',
  'ecosystem.config.cjs',
  'src/jarvis-gateway.js',
];

const MAX_REPAIRS_PER_HOUR = 3;
const ERROR_THRESHOLD = 3;          // occurrences avant déclenchement
const ERROR_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const BRAIN_URL = 'http://localhost:8003';
const REPAIRS_LOG = path.resolve('data/repairs.jsonl');

// ─── État en mémoire ──────────────────────────────────────────────────────────

/** @type {Map<string, {count: number, firstSeen: number}>} */
const errorTracker = new Map();

let repairsThisHour = 0;
let hourWindowStart = Date.now();

// ─── Utilitaires ──────────────────────────────────────────────────────────────

/**
 * Envoie un message Telegram à l'admin.
 * @param {string} text
 */
async function sendTelegram(text) {
  const token = process.env.BOT_TOKEN;
  const chatId = process.env.ADMIN_TELEGRAM_ID;
  if (!token || !chatId) {
    console.warn('[self-repair] BOT_TOKEN ou ADMIN_TELEGRAM_ID manquant — alerte Telegram ignorée');
    return;
  }
  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
    });
  } catch (err) {
    console.error('[self-repair] Échec envoi Telegram:', err.message);
  }
}

/**
 * Écrit une entrée dans data/repairs.jsonl.
 * @param {object} entry
 */
function logRepair(entry) {
  try {
    fs.mkdirSync(path.dirname(REPAIRS_LOG), { recursive: true });
    fs.appendFileSync(REPAIRS_LOG, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n');
  } catch (err) {
    console.error('[self-repair] Impossible d\'écrire repairs.jsonl:', err.message);
  }
}

/**
 * Remet à zéro le compteur horaire si l'heure est écoulée.
 */
function refreshHourlyCounter() {
  if (Date.now() - hourWindowStart >= 60 * 60 * 1000) {
    repairsThisHour = 0;
    hourWindowStart = Date.now();
  }
}

/**
 * Extrait le chemin du fichier source depuis un stack trace Node.js.
 * @param {string} errorMsg
 * @returns {string|null}
 */
function extractSourceFile(errorMsg) {
  const match = errorMsg.match(/at .+ \((.+\.js):\d+/);
  return match ? match[1] : null;
}

/**
 * Génère une clé de tracking unique pour une erreur (process + 80 premiers chars).
 * @param {string} processName
 * @param {string} errorMsg
 * @returns {string}
 */
function errorKey(processName, errorMsg) {
  return `${processName}::${errorMsg.slice(0, 80)}`;
}

// ─── Pipeline de réparation ───────────────────────────────────────────────────

/**
 * Demande au brain LLM un patch pour l'erreur donnée.
 * @param {string} errorMsg
 * @param {string} sourceCode
 * @returns {Promise<object>}
 */
async function askBrainForPatch(errorMsg, sourceCode) {
  const prompt =
    `Ce code Node.js a cette erreur: ${errorMsg}. ` +
    `Fichier: ${sourceCode}. ` +
    `Propose un patch JSON minimal: {"file": "chemin", "line": N, "old": "...", "new": "..."} ` +
    `ou {"skip": true} si non réparable. Réponds UNIQUEMENT en JSON.`;

  const resp = await fetch(`${BRAIN_URL}/think`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  });

  if (!resp.ok) throw new Error(`Brain HTTP ${resp.status}`);
  const text = await resp.text();

  // Extraire le JSON même si le brain enveloppe sa réponse dans du texte
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Réponse brain non JSON: ' + text.slice(0, 200));
  return JSON.parse(jsonMatch[0]);
}

/**
 * Applique le patch sur le fichier source avec backup.
 * @param {object} patch
 * @returns {Promise<{success: boolean, backupPath?: string, reason?: string}>}
 */
async function applyPatch(patch) {
  const { file, old: oldStr, new: newStr } = patch;

  // Vérifier que le fichier n'est pas protégé
  const basename = path.basename(file);
  const normalized = file.replace(/\\/g, '/');
  if (PROTECTED_FILES.some((p) => normalized.endsWith(p) || basename === p)) {
    return { success: false, reason: `Fichier protégé: ${file}` };
  }

  if (!fs.existsSync(file)) {
    return { success: false, reason: `Fichier introuvable: ${file}` };
  }

  // Backup
  const backupPath = `${file}.bak.${Date.now()}`;
  fs.copyFileSync(file, backupPath);

  // Remplacer la première occurrence
  let content = fs.readFileSync(file, 'utf8');
  if (!content.includes(oldStr)) {
    fs.unlinkSync(backupPath); // backup inutile
    return { success: false, reason: `Pattern "old" introuvable dans ${file}` };
  }
  content = content.replace(oldStr, newStr); // première occurrence uniquement
  fs.writeFileSync(file, content, 'utf8');

  return { success: true, backupPath };
}

/**
 * Redémarre un processus PM2 et attend qu'il soit online.
 * @param {string} processName
 * @returns {Promise<boolean>} true si online après 10s
 */
function restartAndCheck(processName) {
  return new Promise((resolve) => {
    pm2.restart(processName, (err) => {
      if (err) {
        console.error(`[self-repair] Impossible de redémarrer ${processName}:`, err.message);
        return resolve(false);
      }
      // Attendre 10 secondes puis vérifier l'état
      setTimeout(() => {
        pm2.describe(processName, (err2, list) => {
          if (err2 || !list || list.length === 0) return resolve(false);
          const status = list[0]?.pm2_env?.status;
          resolve(status === 'online');
        });
      }, 10_000);
    });
  });
}

/**
 * Restaure un backup et redémarre le processus.
 * @param {string} file
 * @param {string} backupPath
 * @param {string} processName
 */
async function rollback(file, backupPath, processName) {
  try {
    fs.copyFileSync(backupPath, file);
    console.warn(`[self-repair] Rollback effectué: ${file} ← ${backupPath}`);
  } catch (err) {
    console.error('[self-repair] Échec rollback:', err.message);
  }
  await new Promise((resolve) => pm2.restart(processName, () => resolve()));
}

/**
 * Pipeline complet de réparation pour un processus/erreur donné.
 * @param {string} processName
 * @param {string} errorMsg
 */
async function repairProcess(processName, errorMsg) {
  refreshHourlyCounter();

  if (repairsThisHour >= MAX_REPAIRS_PER_HOUR) {
    const msg =
      `⚠️ *HITL requis* — Limite de ${MAX_REPAIRS_PER_HOUR} auto-repairs/heure atteinte.\n` +
      `Processus: \`${processName}\`\nErreur: \`${errorMsg.slice(0, 200)}\``;
    console.warn('[self-repair] Limite horaire atteinte, envoi alerte Telegram HITL');
    await sendTelegram(msg);
    logRepair({ process: processName, error: errorMsg.slice(0, 200), status: 'rate_limited' });
    return;
  }

  console.log(`[self-repair] Déclenchement repair pour: ${processName}`);

  // a. Identifier le fichier source
  const sourceFile = extractSourceFile(errorMsg);
  if (!sourceFile) {
    console.log('[self-repair] Impossible d\'extraire le fichier source du stack trace');
    logRepair({ process: processName, error: errorMsg.slice(0, 200), status: 'no_source_file' });
    return;
  }

  // b. Lire le fichier source
  let sourceCode;
  try {
    sourceCode = fs.readFileSync(sourceFile, 'utf8');
  } catch {
    console.log(`[self-repair] Fichier source illisible: ${sourceFile}`);
    logRepair({ process: processName, error: errorMsg.slice(0, 200), status: 'unreadable_source' });
    return;
  }

  // c. Demander un patch au brain
  let patch;
  try {
    patch = await askBrainForPatch(errorMsg, sourceCode.slice(0, 3000));
  } catch (err) {
    console.error('[self-repair] Brain inaccessible:', err.message);
    logRepair({ process: processName, error: errorMsg.slice(0, 200), status: 'brain_error' });
    return;
  }

  // d. Si skip:true → abandonner
  if (patch.skip) {
    console.log('[self-repair] Brain a répondu skip:true — patch non applicable');
    logRepair({ process: processName, error: errorMsg.slice(0, 200), patch, status: 'skipped' });
    return;
  }

  // e. Vérifier et appliquer le patch
  if (!patch.file || !patch.old || !patch.new) {
    console.log('[self-repair] Patch incomplet reçu du brain:', JSON.stringify(patch));
    logRepair({ process: processName, error: errorMsg.slice(0, 200), patch, status: 'incomplete_patch' });
    return;
  }

  const applyResult = await applyPatch(patch);
  if (!applyResult.success) {
    console.warn('[self-repair] Patch non appliqué:', applyResult.reason);
    logRepair({ process: processName, error: errorMsg.slice(0, 200), patch, status: 'patch_failed', reason: applyResult.reason });
    return;
  }

  repairsThisHour++;
  console.log(`[self-repair] Patch appliqué, redémarrage de ${processName}…`);

  // Redémarrer et vérifier
  const isOnline = await restartAndCheck(processName);

  if (isOnline) {
    console.log(`[self-repair] ✓ ${processName} est de nouveau online`);
    logRepair({ process: processName, error: errorMsg.slice(0, 200), patch, status: 'success' });
    await sendTelegram(`✅ *Auto-repair réussi*\nProcessus: \`${processName}\`\nFichier patché: \`${patch.file}\``);
  } else {
    // Rollback
    console.warn(`[self-repair] ${processName} toujours en erreur — rollback`);
    await rollback(patch.file, applyResult.backupPath, processName);
    logRepair({ process: processName, error: errorMsg.slice(0, 200), patch, status: 'rolled_back', rollback: true });
    await sendTelegram(
      `🔴 *Auto-repair échoué — Rollback effectué*\nProcessus: \`${processName}\`\nFichier: \`${patch.file}\`\nIntervention manuelle requise.`
    );
  }
}

// ─── Démarrage ────────────────────────────────────────────────────────────────

console.log('[self-repair] Démarrage du moteur de réparation automatique…');

pm2.connect((err) => {
  if (err) {
    console.error('[self-repair] Impossible de se connecter à PM2:', err.message);
    process.exit(1);
  }

  pm2.launchBus((busErr, bus) => {
    if (busErr) {
      console.error('[self-repair] Impossible de lancer le bus PM2:', busErr.message);
      pm2.disconnect();
      process.exit(1);
    }

    console.log('[self-repair] Bus PM2 connecté — écoute des erreurs…');

    bus.on('log:err', async (packet) => {
      const processName = packet?.process?.name || 'unknown';
      const errorMsg = String(packet?.data || '').trim();

      if (!errorMsg) return;

      // Tracker les erreurs répétées
      const key = errorKey(processName, errorMsg);
      const now = Date.now();
      const existing = errorTracker.get(key);

      if (!existing || now - existing.firstSeen > ERROR_WINDOW_MS) {
        // Nouvelle erreur ou fenêtre expirée
        errorTracker.set(key, { count: 1, firstSeen: now });
      } else {
        existing.count++;
        if (existing.count >= ERROR_THRESHOLD) {
          // Seuil atteint — déclencher la réparation et réinitialiser le tracker
          errorTracker.delete(key);
          await repairProcess(processName, errorMsg);
        }
      }
    });
  });
});
