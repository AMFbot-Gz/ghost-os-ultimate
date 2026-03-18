import cron from 'node-cron';
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DATA_DIR = resolve(ROOT, 'data');
const BRAIN_URL = 'http://localhost:8003';
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.ADMIN_TELEGRAM_ID;

// Helper : lit un fichier JSONL et retourne un array d'objets (skip lignes invalides)
function readJsonl(filePath) {
  if (!existsSync(filePath)) return [];
  const lines = readFileSync(filePath, 'utf-8').split('\n');
  const results = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      results.push(JSON.parse(trimmed));
    } catch {
      // ligne invalide ignorée
    }
  }
  return results;
}

// Helper : envoie un message Telegram à l'admin
async function sendTelegram(text) {
  if (!BOT_TOKEN || !CHAT_ID) return;
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT_ID, text })
  }).catch(() => {});
}

// ─── TÂCHE 1 : memory-consolidation — 02:00 ──────────────────────────────────
// Consolide les épisodes en leçons apprises groupées par agent
cron.schedule('0 2 * * *', async () => {
  try {
    const episodesPath = resolve(DATA_DIR, 'episodes.jsonl');
    const episodes = readJsonl(episodesPath);

    if (episodes.length < 5) {
      console.log('[NightWorker] memory-consolidation: moins de 5 épisodes, skip');
      return;
    }

    // Grouper par tags[0] (agent)
    const groups = {};
    for (const ep of episodes) {
      const agent = (ep.tags && ep.tags[0]) ? ep.tags[0] : 'unknown';
      if (!groups[agent]) groups[agent] = [];
      groups[agent].push(ep);
    }

    const lessons = [];
    for (const [agent, eps] of Object.entries(groups)) {
      const total = eps.length;
      const successes = eps.filter(e => e.success === true).length;
      const successRate = total > 0 ? successes / total : 0;
      const durations = eps.map(e => e.duration).filter(d => typeof d === 'number');
      const avgDuration = durations.length > 0
        ? durations.reduce((a, b) => a + b, 0) / durations.length
        : 0;

      lessons.push({
        pattern: `agent:${agent}`,
        agent,
        successRate: parseFloat(successRate.toFixed(4)),
        avgDuration: parseFloat(avgDuration.toFixed(2)),
        sampleCount: total,
        updatedAt: new Date().toISOString()
      });
    }

    const lessonsPath = resolve(DATA_DIR, 'learned-lessons.json');
    writeFileSync(lessonsPath, JSON.stringify(lessons, null, 2), 'utf-8');
    console.log(`[NightWorker] memory-consolidation: ${lessons.length} leçons créées`);
  } catch (err) {
    console.error('[NightWorker] memory-consolidation error:', err.message);
  }
});

// ─── TÂCHE 2 : skill-optimizer — 02:30 ───────────────────────────────────────
// Identifie les skills défaillants et leur suggère des améliorations via le brain
cron.schedule('30 2 * * *', async () => {
  try {
    const historyPath = resolve(DATA_DIR, 'goals-history.jsonl');
    const history = readJsonl(historyPath);

    // Grouper par goalId
    const groups = {};
    for (const entry of history) {
      if (!entry.goalId) continue;
      if (!groups[entry.goalId]) groups[entry.goalId] = [];
      groups[entry.goalId].push(entry);
    }

    const skillsDir = resolve(ROOT, 'skills');
    let analyzed = 0;

    for (const [goalId, entries] of Object.entries(groups)) {
      const total = entries.length;
      const failures = entries.filter(e => e.result === 'failure' || e.result === false).length;
      const failureRate = total > 0 ? failures / total : 0;

      // Skip si taux d'échec <= 30%
      if (failureRate <= 0.3) continue;

      const skillPath = resolve(skillsDir, goalId, 'skill.js');
      let code = '';
      if (existsSync(skillPath)) {
        code = readFileSync(skillPath, 'utf-8').slice(0, 500);
      }

      // Appel au brain pour suggestion d'amélioration
      let suggestion = 'Aucune suggestion disponible (brain inaccessible).';
      try {
        const response = await fetch(`${BRAIN_URL}/think`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: `Ce skill a un taux d'échec élevé: ${goalId}. Voici le code: ${code}. Propose une amélioration en 2-3 phrases.`
          })
        });
        if (response.ok) {
          const data = await response.json();
          suggestion = data.response || data.text || suggestion;
        }
      } catch {
        // Brain inaccessible, on continue
      }

      // Écrire l'amélioration dans skills/{goalId}/improvement.md
      const skillDir = resolve(skillsDir, goalId);
      if (!existsSync(skillDir)) mkdirSync(skillDir, { recursive: true });
      const improvementPath = resolve(skillDir, 'improvement.md');
      const content = `# Amélioration suggérée — ${goalId}\n\n`
        + `**Taux d'échec**: ${(failureRate * 100).toFixed(1)}% (${failures}/${total})\n`
        + `**Analysé le**: ${new Date().toISOString()}\n\n`
        + `## Suggestion\n\n${suggestion}\n`;
      writeFileSync(improvementPath, content, 'utf-8');
      analyzed++;
    }

    console.log(`[NightWorker] skill-optimizer: ${analyzed} skills analysés`);
  } catch (err) {
    console.error('[NightWorker] skill-optimizer error:', err.message);
  }
});

// ─── TÂCHE 3 : index-rebuild — 03:00 ─────────────────────────────────────────
// Reconstruit le registre complet de tous les skills disponibles
cron.schedule('0 3 * * *', async () => {
  try {
    const skillsDir = resolve(ROOT, 'skills');
    if (!existsSync(skillsDir)) {
      console.log('[NightWorker] index-rebuild: dossier skills/ introuvable, skip');
      return;
    }

    const entries = [];

    // Lecture synchrone des sous-dossiers
    const { readdirSync } = await import('fs');
    const items = readdirSync(skillsDir, { withFileTypes: true });

    for (const item of items) {
      if (!item.isDirectory()) continue;
      const skillId = item.name;
      const skillJsPath = resolve(skillsDir, skillId, 'skill.js');
      const manifestPath = resolve(skillsDir, skillId, 'manifest.json');

      if (!existsSync(skillJsPath) || !existsSync(manifestPath)) continue;

      let manifest = {};
      try {
        manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
      } catch {
        // manifest invalide, on continue avec les infos minimales
      }

      entries.push({
        id: skillId,
        name: manifest.name || skillId,
        description: manifest.description || '',
        version: manifest.version || '0.0.1',
        tags: manifest.tags || [],
        path: `skills/${skillId}/skill.js`,
        indexedAt: new Date().toISOString()
      });
    }

    const registryPath = resolve(skillsDir, 'registry.json');
    writeFileSync(registryPath, JSON.stringify(entries, null, 2), 'utf-8');
    console.log(`[NightWorker] index-rebuild: ${entries.length} skills indexés`);
  } catch (err) {
    console.error('[NightWorker] index-rebuild error:', err.message);
  }
});

// ─── TÂCHE 4 : daily-briefing-prep — 07:30 ───────────────────────────────────
// Prépare le briefing quotidien et l'envoie via Telegram
cron.schedule('30 7 * * *', async () => {
  try {
    const now = Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000;

    // Lire goals-history.jsonl des dernières 24h
    const historyPath = resolve(DATA_DIR, 'goals-history.jsonl');
    const allHistory = readJsonl(historyPath);
    const recentHistory = allHistory.filter(e => e.ts && (now - new Date(e.ts).getTime()) < oneDayMs);

    // Lire repairs.jsonl des dernières 24h (si existe)
    const repairsPath = resolve(DATA_DIR, 'repairs.jsonl');
    const allRepairs = readJsonl(repairsPath);
    const recentRepairs = allRepairs.filter(e => e.ts && (now - new Date(e.ts).getTime()) < oneDayMs);

    // Grouper l'historique par goalId pour identifier les top issues (>50% d'échec)
    const goalGroups = {};
    for (const entry of recentHistory) {
      if (!entry.goalId) continue;
      if (!goalGroups[entry.goalId]) goalGroups[entry.goalId] = [];
      goalGroups[entry.goalId].push(entry);
    }

    const topIssues = [];
    for (const [goalId, entries] of Object.entries(goalGroups)) {
      const total = entries.length;
      const failures = entries.filter(e => e.result === 'failure' || e.result === false).length;
      if (total > 0 && failures / total > 0.5) {
        topIssues.push({ goalId, failureRate: parseFloat((failures / total).toFixed(4)), count: total });
      }
    }

    // Construire les recommandations
    const recommendations = [];
    for (const issue of topIssues) {
      recommendations.push(`Vérifier le skill ${issue.goalId} qui échoue souvent`);
    }
    if (recentRepairs.length > 0) {
      recommendations.push(`${recentRepairs.length} repairs effectués cette nuit`);
    }

    const briefing = {
      date: new Date().toISOString(),
      missionsCount: recentHistory.length,
      repairsCount: recentRepairs.length,
      topIssues,
      recommendations
    };

    // Écrire data/daily-briefing.json
    const briefingPath = resolve(DATA_DIR, 'daily-briefing.json');
    writeFileSync(briefingPath, JSON.stringify(briefing, null, 2), 'utf-8');

    // Envoyer via Telegram
    const topIssuesText = topIssues.length > 0
      ? topIssues.map(i => `${i.goalId} (${(i.failureRate * 100).toFixed(0)}%)`).join(', ')
      : 'aucun';
    const message = `☀️ Jarvis Daily Briefing\n${recentHistory.length} missions | ${recentRepairs.length} repairs\nTop issues: ${topIssuesText}`;
    await sendTelegram(message);

    console.log('[NightWorker] daily-briefing-prep envoyé');
  } catch (err) {
    console.error('[NightWorker] daily-briefing-prep error:', err.message);
  }
});

console.log('[NightWorker] Démarrage — 4 tâches nocturnes schedulées');
console.log('[NightWorker] memory-consolidation: 02:00');
console.log('[NightWorker] skill-optimizer: 02:30');
console.log('[NightWorker] index-rebuild: 03:00');
console.log('[NightWorker] daily-briefing-prep: 07:30');
