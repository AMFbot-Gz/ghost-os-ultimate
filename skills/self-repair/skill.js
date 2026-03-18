/**
 * Skill self-repair — Ghost OS Ultimate
 * Déclenché manuellement via Telegram pour analyser les erreurs d'un service PM2.
 * N'applique pas de patch automatiquement — retourne uniquement l'analyse du brain.
 */

import pm2 from 'pm2';
import { execSync } from 'child_process';

const BRAIN_URL = process.env.BRAIN_URL || 'http://localhost:8003';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Récupère les dernières entrées d'erreur PM2 pour un service donné.
 * @param {string} service  Nom du processus PM2
 * @returns {Promise<string>}  Logs bruts (ou message d'absence)
 */
async function getRecentErrors(service) {
  return new Promise((resolve) => {
    pm2.connect((connectErr) => {
      if (connectErr) {
        return resolve(`Impossible de se connecter à PM2: ${connectErr.message}`);
      }

      pm2.describe(service, (descErr, list) => {
        pm2.disconnect();

        if (descErr || !list || list.length === 0) {
          return resolve(`Service "${service}" introuvable dans PM2.`);
        }

        const proc = list[0];
        const logFile = proc?.pm2_env?.pm_err_log_path;

        if (!logFile) {
          return resolve(`Aucun fichier de log d'erreur trouvé pour "${service}".`);
        }

        // Lire les 100 dernières lignes du fichier de log d'erreurs
        try {
          const lines = execSync(`tail -n 100 "${logFile}" 2>/dev/null || echo ""`).toString().trim();
          resolve(lines || `Log vide pour "${service}".`);
        } catch (e) {
          resolve(`Impossible de lire le log: ${e.message}`);
        }
      });
    });
  });
}

/**
 * Envoie les logs au brain LLM pour analyse.
 * @param {string} logs   Logs d'erreurs bruts
 * @param {string} service  Nom du service
 * @returns {Promise<string>}  Analyse textuelle du brain
 */
async function analyzeWithBrain(logs, service) {
  const prompt =
    `Analyse ces logs d'erreur PM2 pour le service "${service}":\n\n${logs.slice(0, 4000)}\n\n` +
    `Identifie la cause racine, évalue la gravité, et propose des pistes de correction concrètes. ` +
    `Réponds en français de façon concise.`;

  try {
    const resp = await fetch(`${BRAIN_URL}/think`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
    });

    if (!resp.ok) throw new Error(`Brain HTTP ${resp.status}`);
    const data = await resp.json().catch(async () => ({ result: await resp.text() }));
    return data.result || data.response || data.text || JSON.stringify(data);
  } catch (err) {
    return `Brain inaccessible (${BRAIN_URL}): ${err.message}`;
  }
}

// ─── Export principal ─────────────────────────────────────────────────────────

/**
 * Point d'entrée du skill.
 * @param {{ service?: string }} params
 * @returns {Promise<{success: boolean, service: string, analysis: string}>}
 */
export async function run({ service = '' }) {
  if (!service) {
    return { success: false, service, analysis: 'Paramètre "service" manquant. Usage: répare le service <nom>' };
  }

  // 1. Récupérer les dernières erreurs PM2 pour le service
  const logs = await getRecentErrors(service);

  // 2. POST /think au brain :8003 pour analyse
  const analysis = await analyzeWithBrain(logs, service);

  // 3. Retourner le résultat (pas d'auto-patch ici)
  return {
    success: true,
    service,
    analysis: analysis.substring(0, 500),
  };
}
