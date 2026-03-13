/**
 * toolRouter.js — Router d'outils réel pour agentLoop v4.1
 * Branche les appels d'outils vers les skills réels de LaRuche
 * Skills disponibles : take_screenshot, open_app, goto_url, run_command,
 *   type_text, press_key, press_enter, http_fetch, read_file,
 *   list_big_files, summarize_project, run_shell
 */

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../../');

// Cache des skill handlers
const _skillCache = new Map();

async function loadSkillHandler(skillName) {
  if (_skillCache.has(skillName)) return _skillCache.get(skillName);
  const candidates = [
    join(ROOT, 'skills', skillName, 'index.js'),
    join(ROOT, 'skills', skillName, 'skill.js'),
  ];
  const skillPath = candidates.find(existsSync);
  if (!skillPath) return null;
  try {
    const mod = await import(`${skillPath}?t=${Date.now()}`);
    const handler = typeof mod.run === 'function' ? mod.run : null;
    _skillCache.set(skillName, handler);
    return handler;
  } catch {
    return null;
  }
}

// Alias : noms d'outils agentLoop → noms de skills LaRuche
const TOOL_ALIAS = {
  'os.openApp':        'open_app',
  'os.screenshot':     'take_screenshot',
  'pw.screenshot':     'take_screenshot',
  'pw.goto':           'goto_url',
  'pw.launch':         'open_app',
  'pw.click':          'press_key',
  'pw.fill':           'type_text',
  'pw.press':          'press_key',
  'typeText':          'type_text',
  'execSafe':          'run_command',
  'goto_url':          'goto_url',
  'open_app':          'open_app',
  'take_screenshot':   'take_screenshot',
  'run_command':       'run_command',
  'run_shell':         'run_shell',
  'type_text':         'type_text',
  'press_key':         'press_key',
  'press_enter':       'press_enter',
  'http_fetch':        'http_fetch',
  'read_file':         'read_file',
  'list_big_files':    'list_big_files',
  'summarize_project': 'summarize_project',
};

// Adaptateurs d'arguments : certains tools ont des noms de params différents
function adaptArgs(toolName, args) {
  switch (toolName) {
    case 'os.openApp':
    case 'pw.launch':
      return { app: args.app || args.name || args.application };
    case 'pw.goto':
    case 'goto_url':
      return { url: args.url || args.href };
    case 'pw.fill':
    case 'typeText':
    case 'type_text':
      return { text: args.text || args.value || args.content };
    case 'pw.press':
    case 'press_key':
      return { key: args.key || args.code || args.keyCode };
    case 'execSafe':
    case 'run_command':
      return { command: args.command || args.cmd || args.shell };
    default:
      return args;
  }
}

export class ToolRouter {
  constructor({ allowed = [], refused = [] } = {}) {
    this.allowed = allowed;
    this.refused = new Set(refused);
  }

  /**
   * Exécute un outil via les skills LaRuche.
   */
  async call(toolName, args = {}) {
    if (this.refused.has(toolName)) {
      return { success: false, error: `Tool "${toolName}" refusé par configuration agent` };
    }
    if (this.allowed.length > 0 && !this.allowed.includes(toolName)) {
      return { success: false, error: `Tool "${toolName}" non autorisé (pas dans allowed_tools)` };
    }

    const skillName = TOOL_ALIAS[toolName] || toolName;
    const adaptedArgs = adaptArgs(toolName, args);

    const handler = await loadSkillHandler(skillName);
    if (!handler) {
      return { success: false, error: `Skill "${skillName}" introuvable pour l'outil "${toolName}"` };
    }

    try {
      const result = await handler(adaptedArgs);
      return result ?? { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Liste les outils disponibles (skills chargés + aliases).
   */
  listAvailable() {
    return Object.keys(TOOL_ALIAS);
  }
}
