/**
 * src/mac-control.js — Contrôle Mac direct (bypass Queen)
 *
 * Actions natives macOS via les agents Python déjà UP :
 *   - computer_use.py :8015  → screenshot (Retina-corrigé)
 *   - executor.py     :8004  → shell, click, type, scroll
 *   - computer_use.py :8015  → session CU (multi-étapes)
 *
 * Utilisé par jarvis-gateway.js pour les actions simples sans passer par Queen.
 */

import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXECUTOR_URL = 'http://localhost:8004';
const CU_URL       = 'http://localhost:8015';
const SCREENSHOTS_DIR = '/tmp/jarvis_screenshots';

// Créer le dossier screenshots si nécessaire
if (!existsSync(SCREENSHOTS_DIR)) mkdirSync(SCREENSHOTS_DIR, { recursive: true });

// ─── Utilitaires ──────────────────────────────────────────────────────────────

async function callExecutor(endpoint, body, timeoutMs = 15000) {
  const res = await fetch(`${EXECUTOR_URL}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  return res.json();
}

// ─── Screenshot ───────────────────────────────────────────────────────────────

/**
 * Prend un screenshot Retina-corrigé via computer_use.py :8015.
 * Retourne { path, width, height } ou { error }.
 */
export async function takeScreenshot(label = '') {
  const res = await fetch(`${CU_URL}/screenshot`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label }),
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json();

  if (data.error) return { error: data.error };

  // Décoder base64 → fichier PNG
  const filename = `${SCREENSHOTS_DIR}/ss_${Date.now()}.png`;
  const buf = Buffer.from(data.base64, 'base64');
  writeFileSync(filename, buf);

  return {
    path: filename,
    width: parseInt(data.resolution?.split('×')[0]) || 1536,
    height: parseInt(data.resolution?.split('×')[1]) || 960,
    retina: data.retina,
  };
}

// ─── Ouvrir une application ────────────────────────────────────────────────────

const APP_NAME_MAP = {
  // Noms français → noms macOS exacts
  chrome:         'Google Chrome',
  'google chrome':'Google Chrome',
  safari:         'Safari',
  firefox:        'Firefox',
  terminal:       'Terminal',
  finder:         'Finder',
  mail:           'Mail',
  notes:          'Notes',
  calendrier:     'Calendar',
  calendar:       'Calendar',
  photos:         'Photos',
  musique:        'Music',
  music:          'Music',
  messages:       'Messages',
  facetime:       'FaceTime',
  spotify:        'Spotify',
  slack:          'Slack',
  discord:        'Discord',
  zoom:           'Zoom',
  figma:          'Figma',
  vscode:         'Visual Studio Code',
  'vs code':      'Visual Studio Code',
  xcode:          'Xcode',
  pages:          'Pages',
  numbers:        'Numbers',
  keynote:        'Keynote',
  word:           'Microsoft Word',
  excel:          'Microsoft Excel',
  powerpoint:     'Microsoft PowerPoint',
  teams:          'Microsoft Teams',
  outlook:        'Microsoft Outlook',
  notion:         'Notion',
  obsidian:       'Obsidian',
  telegram:       'Telegram',
  whatsapp:       'WhatsApp',
};

/**
 * Extrait le nom d'app depuis un texte naturel.
 * "ouvre Chrome" → "Google Chrome"
 */
export function extractAppName(text) {
  // Supprimer les mots d'intention
  const clean = text
    .toLowerCase()
    .replace(/^(ouvre|lance|démarre|start|open|va sur|affiche|montre)\s+/i, '')
    .replace(/[-_]/g, ' ')
    .trim();

  // Chercher dans la map
  for (const [key, val] of Object.entries(APP_NAME_MAP)) {
    if (clean.includes(key)) return val;
  }

  // Capitaliser la première lettre comme fallback
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

/**
 * Ouvre une application macOS.
 */
export async function openApp(appName) {
  const resolved = APP_NAME_MAP[appName.toLowerCase()] || appName;
  const result = await callExecutor('/shell', { command: `open -a "${resolved}"` });

  if (result.blocked) return { success: false, error: `Commande bloquée: ${resolved}` };
  if (result.returncode !== 0 && result.stderr) {
    return { success: false, error: result.stderr.trim().substring(0, 200) };
  }

  await new Promise(r => setTimeout(r, 1500)); // Laisser l'app s'ouvrir
  return { success: true, app: resolved, message: `✅ ${resolved} ouvert` };
}

// ─── Navigation URL ───────────────────────────────────────────────────────────

/**
 * Extrait une URL depuis un texte (support gmail, google, etc.)
 */
export function extractUrl(text) {
  const URL_SHORTCUTS = {
    gmail:      'https://mail.google.com',
    'google mail': 'https://mail.google.com',
    google:     'https://www.google.com',
    youtube:    'https://www.youtube.com',
    github:     'https://www.github.com',
    shopify:    'https://admin.shopify.com',
    notion:     'https://www.notion.so',
    slack:      'https://slack.com',
    twitter:    'https://www.twitter.com',
    'x.com':    'https://www.x.com',
    instagram:  'https://www.instagram.com',
    facebook:   'https://www.facebook.com',
    linkedin:   'https://www.linkedin.com',
  };

  const lower = text.toLowerCase();
  for (const [key, url] of Object.entries(URL_SHORTCUTS)) {
    if (lower.includes(key)) return url;
  }

  // Chercher une vraie URL
  const urlMatch = text.match(/https?:\/\/[^\s]+/);
  if (urlMatch) return urlMatch[0];

  // Nom de domaine simple
  const domainMatch = text.match(/\b([a-z0-9-]+\.(com|fr|io|net|org|co))\b/i);
  if (domainMatch) return `https://${domainMatch[0]}`;

  return null;
}

/**
 * Ouvre une URL dans Chrome (ou Safari).
 */
export async function goToUrl(url) {
  const script = `tell application "Google Chrome" to open location "${url}"`;
  const result = await callExecutor('/shell', {
    command: `osascript -e '${script}'`,
  });

  if (result.returncode !== 0) {
    // Fallback: open system default
    const r2 = await callExecutor('/shell', { command: `open "${url}"` });
    return { success: r2.returncode === 0, url, message: `🌐 ${url} ouvert` };
  }

  await new Promise(r => setTimeout(r, 2000)); // Laisser la page charger
  return { success: true, url, message: `🌐 ${url} ouvert` };
}

// ─── Type text ────────────────────────────────────────────────────────────────

export async function typeText(text) {
  const result = await callExecutor('/type', { text, interval: 0.04 }, 20000);
  return { success: !result.error, message: `⌨️ Tapé: "${text.substring(0, 50)}"` };
}

// ─── Press key ────────────────────────────────────────────────────────────────

export async function pressKey(key) {
  const cmd = `python3 -c "import pyautogui; pyautogui.FAILSAFE=False; pyautogui.hotkey('${key}')"`;
  const result = await callExecutor('/shell', { command: cmd });
  return { success: result.returncode === 0 };
}

// ─── Smart click ──────────────────────────────────────────────────────────────

export async function smartClick(query) {
  const result = await callExecutor('/shell', {
    command: `python3 src/accessibility.py smart_click --query "${query.replace(/"/g, '\\"')}"`,
  }, 20000);

  try {
    const parsed = JSON.parse(result.stdout || '{}');
    if (parsed.success) {
      return { success: true, message: `🖱 Cliqué: "${parsed.clicked || query}"` };
    }
  } catch {}

  return { success: false, error: result.stderr?.substring(0, 200) || 'Élément introuvable' };
}

// ─── Session CU multi-étapes ──────────────────────────────────────────────────

/**
 * Lance une session computer_use pour une mission complexe.
 * Poll jusqu'à completion (max 90s).
 * Retourne { success, result, screenshot_path }
 */
export async function runCUSession(goal, maxSteps = 10) {
  // Démarrer la session
  const startRes = await fetch(`${CU_URL}/session/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ goal, max_steps: maxSteps, mode: 'local' }),
    signal: AbortSignal.timeout(10000),
  });
  const session = await startRes.json();
  const sessionId = session.session_id;
  if (!sessionId) return { success: false, error: 'Session non créée' };

  // Poller toutes les 3s jusqu'à completion (max 90s)
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 3000));
    const pollRes = await fetch(`${CU_URL}/session/${sessionId}`, {
      signal: AbortSignal.timeout(5000),
    });
    const state = await pollRes.json();

    if (state.status === 'completed') {
      // Prendre un screenshot final
      const ss = await takeScreenshot('résultat final');
      return {
        success: true,
        result: state.final_result || `Mission accomplie (${state.steps_count} étapes)`,
        screenshot_path: ss.path || null,
        steps: state.steps_count,
      };
    }

    if (state.status === 'failed' || state.status === 'stopped') {
      return { success: false, error: state.error || 'Session échouée', result: state.final_result };
    }
  }

  return { success: false, error: 'Timeout 90s dépassé' };
}

// ─── Décomposition multi-étapes ────────────────────────────────────────────────

const STEP_PATTERNS = [
  { pattern: /screenshot|capture|photo|écran/i,          action: 'screenshot' },
  { pattern: /ouvre|lance|open\s+\w/i,                   action: 'open_app'  },
  { pattern: /va\s+sur|navigue|ouvre\s+[a-z]+\.[a-z]/i, action: 'goto_url'  },
  { pattern: /tape|écris|saisis|type/i,                  action: 'type_text' },
  { pattern: /clique|click/i,                             action: 'click'    },
  { pattern: /attends?|wait/i,                            action: 'wait'     },
];

/**
 * Décompose une commande complexe en étapes simples.
 * "ouvre Chrome, va sur gmail, prends un screenshot"
 * → [{action:'open_app', input:'Chrome'}, {action:'goto_url', input:'gmail'}, {action:'screenshot'}]
 */
export function decomposeCommand(text) {
  // Séparer par virgule, "puis", "ensuite", "et"
  const parts = text
    .split(/,|\bpuis\b|\bensuite\b|\bet\b/i)
    .map(s => s.trim())
    .filter(s => s.length > 2);

  const steps = [];
  for (const part of parts) {
    for (const { pattern, action } of STEP_PATTERNS) {
      if (pattern.test(part)) {
        steps.push({ action, raw: part });
        break;
      }
    }
  }

  return steps;
}

/**
 * Exécute une liste d'étapes décomposées.
 * Retourne la liste des résultats et le dernier screenshot si présent.
 */
export async function executeSteps(steps) {
  const results = [];
  let lastScreenshotPath = null;

  for (const step of steps) {
    let res;
    switch (step.action) {
      case 'screenshot': {
        res = await takeScreenshot();
        if (res.path) lastScreenshotPath = res.path;
        results.push({ step: step.raw, ok: !res.error, message: res.error || '📸 Screenshot pris' });
        break;
      }
      case 'open_app': {
        const appName = extractAppName(step.raw);
        res = await openApp(appName);
        results.push({ step: step.raw, ok: res.success, message: res.message || res.error });
        break;
      }
      case 'goto_url': {
        const url = extractUrl(step.raw);
        if (url) {
          res = await goToUrl(url);
          results.push({ step: step.raw, ok: res.success, message: res.message });
        } else {
          results.push({ step: step.raw, ok: false, message: `URL non trouvée dans: "${step.raw}"` });
        }
        break;
      }
      case 'type_text': {
        const textMatch = step.raw.match(/(?:tape|écris|saisis|type)\s+(.+)/i);
        const textToType = textMatch ? textMatch[1] : step.raw;
        res = await typeText(textToType);
        results.push({ step: step.raw, ok: res.success, message: res.message });
        break;
      }
      case 'click': {
        const queryMatch = step.raw.match(/(?:clique|click)(?:\s+sur)?\s+(.+)/i);
        const query = queryMatch ? queryMatch[1] : step.raw;
        res = await smartClick(query);
        results.push({ step: step.raw, ok: res.success, message: res.message || res.error });
        break;
      }
      case 'wait': {
        await new Promise(r => setTimeout(r, 2000));
        results.push({ step: step.raw, ok: true, message: '⏳ Attente 2s' });
        break;
      }
    }

    // Petite pause entre étapes
    await new Promise(r => setTimeout(r, 500));
  }

  return { results, lastScreenshotPath };
}
