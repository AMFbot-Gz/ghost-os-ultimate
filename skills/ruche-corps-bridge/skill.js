/**
 * skills/ruche-corps-bridge/skill.js
 * Bridge vers les outils Python de ruche-corps.
 *
 * Stratégie d'appel :
 *   1. HTTP POST vers http://localhost:8020/tool/{tool}  (si ruche_bridge_server tourne)
 *   2. Fallback subprocess python3 via le module ruche-corps directement
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import path from 'node:path';

const execFileAsync = promisify(execFile);

// ─── Configuration ───────────────────────────────────────────────────────────

const RUCHE_SERVER_URL = 'http://localhost:8020';
const RUCHE_CORPS_PATH = path.join(homedir(), 'Projects', 'ruche-corps');
const HTTP_TIMEOUT_MS  = 30_000;
const SUBPROCESS_TIMEOUT_MS = 30_000;

// ─── Liste complète des outils disponibles dans ruche-corps ──────────────────

const TOOLS_REGISTRY = [
  // ── Système ─────────────────────────────────────────────────────────────
  { name: 'shell',           category: 'system',       description: 'Exécuter une commande shell macOS de façon sécurisée' },
  { name: 'run_python',      category: 'system',       description: 'Exécuter du code Python et retourner le résultat' },
  { name: 'system_info',     category: 'system',       description: 'Infos système : CPU, RAM, disque, processus actifs' },
  { name: 'run_evolution',   category: 'system',       description: 'Lancer le cycle d\'auto-amélioration nocturne immédiatement' },
  { name: 'self_repair_file',category: 'system',       description: 'Auto-réparer un fichier Python cassé via Claude Code CLI' },
  { name: 'reflect_now',     category: 'system',       description: 'Déclencher une réflexion immédiate sur les performances du jour' },
  { name: 'autonomy_config', category: 'system',       description: 'Voir et modifier les niveaux d\'autonomie par catégorie' },
  { name: 'world_state',     category: 'system',       description: 'État système complet avec snapshot WorldState persistant' },
  // ── Fichiers ────────────────────────────────────────────────────────────
  { name: 'read_file',       category: 'files',        description: 'Lire le contenu d\'un fichier' },
  { name: 'write_file',      category: 'files',        description: 'Écrire ou remplacer un fichier complet' },
  { name: 'edit_file',       category: 'files',        description: 'Modifier une section d\'un fichier (chercher et remplacer)' },
  { name: 'list_dir',        category: 'files',        description: 'Lister le contenu d\'un répertoire' },
  { name: 'find_files',      category: 'files',        description: 'Chercher des fichiers par pattern glob' },
  { name: 'load_context',    category: 'files',        description: 'Charger plusieurs fichiers dans le contexte 1M tokens pour analyse' },
  // ── Web ─────────────────────────────────────────────────────────────────
  { name: 'web_search',      category: 'web',          description: 'Rechercher sur le web (DuckDuckGo)' },
  { name: 'web_fetch',       category: 'web',          description: 'Récupérer le contenu textuel d\'une URL web' },
  // ── Computer Use ────────────────────────────────────────────────────────
  { name: 'see_screen',      category: 'computer',     description: 'Voir et analyser l\'écran avec vision IA (Nemotron + llava)' },
  { name: 'click',           category: 'computer',     description: 'Cliquer à des coordonnées précises sur l\'écran' },
  { name: 'double_click',    category: 'computer',     description: 'Double-cliquer sur l\'écran' },
  { name: 'type_text',       category: 'computer',     description: 'Taper du texte au clavier — supporte accents et Unicode' },
  { name: 'hotkey',          category: 'computer',     description: 'Appuyer sur un raccourci clavier' },
  { name: 'move_mouse',      category: 'computer',     description: 'Déplacer la souris vers des coordonnées' },
  { name: 'scroll',          category: 'computer',     description: 'Faire défiler la page (scroll)' },
  { name: 'open_app',        category: 'computer',     description: 'Ouvrir ou mettre au premier plan une application macOS' },
  { name: 'applescript',     category: 'computer',     description: 'Exécuter un script AppleScript macOS' },
  { name: 'drag_drop',       category: 'computer',     description: 'Glisser-déposer de (x1,y1) vers (x2,y2)' },
  { name: 'right_click',     category: 'computer',     description: 'Clic droit sur l\'écran' },
  { name: 'screenshot_region',category:'computer',     description: 'Capturer une région précise de l\'écran et analyser' },
  { name: 'key_press',       category: 'computer',     description: 'Appuyer et maintenir une touche, puis relâcher' },
  // ── Code ────────────────────────────────────────────────────────────────
  { name: 'code_edit',       category: 'code',         description: 'Éditer du code avec aider+qwen3-coder — Claude Code local open source' },
  { name: 'analyze_code',    category: 'code',         description: 'Analyser un fichier ou projet de code avec contexte complet' },
  // ── GitHub ──────────────────────────────────────────────────────────────
  { name: 'github',          category: 'github',       description: 'GitHub : repos, issues, PRs, recherche de code' },
  // ── Ghost OS ────────────────────────────────────────────────────────────
  { name: 'ghost_mission',   category: 'ghost',        description: 'Lancer une mission Ghost OS Ultimate' },
  { name: 'ghost_status',    category: 'ghost',        description: 'Statut complet de Ghost OS Ultimate' },
  // ── IA / Modèles ────────────────────────────────────────────────────────
  { name: 'list_models',     category: 'ai',           description: 'Lister tous les modèles Ollama disponibles' },
  { name: 'mixture_answer',  category: 'ai',           description: 'Réponse enrichie : 3 modèles en parallèle + synthèse Nemotron' },
  // ── Mémoire ─────────────────────────────────────────────────────────────
  { name: 'remember',        category: 'memory',       description: 'Mémoriser un fait important de façon permanente dans la mémoire vectorielle' },
  { name: 'recall',          category: 'memory',       description: 'Rappeler des souvenirs via recherche sémantique' },
  { name: 'summarize_session',category:'memory',       description: 'Résumer et compresser une longue session en mémoire' },
  { name: 'get_learned_rules',category:'memory',       description: 'Consulter les règles apprises par La Ruche (SynapseLayer)' },
  { name: 'add_rule',        category: 'memory',       description: 'Ajouter manuellement une règle dans la mémoire d\'apprentissage' },
  // ── Missions ────────────────────────────────────────────────────────────
  { name: 'submit_mission',  category: 'missions',     description: 'Soumettre une mission longue au worker autonome' },
  { name: 'mission_status',  category: 'missions',     description: 'Voir l\'état de la file de missions autonomes' },
  { name: 'clear_missions',  category: 'missions',     description: 'Annuler toutes les missions en attente dans la file' },
  // ── Swarm ───────────────────────────────────────────────────────────────
  { name: 'delegate_to_swarm',category:'swarm',        description: 'Déléguer une tâche complexe au swarm d\'agents spécialistes en parallèle' },
  { name: 'parallel_tasks',  category: 'system',       description: 'Exécuter plusieurs sous-tâches Ollama EN PARALLÈLE puis synthétiser (Kimi-Overdrive)' },
  // ── Projets ─────────────────────────────────────────────────────────────
  { name: 'list_projects',   category: 'projects',     description: 'Lister tous les projets locaux avec leur statut' },
  { name: 'project_info',    category: 'projects',     description: 'Statut détaillé d\'un projet local (git, dépendances, services)' },
  { name: 'search_projects', category: 'projects',     description: 'Chercher du code dans tous les projets locaux' },
  { name: 'open_project',    category: 'projects',     description: 'Ouvrir un projet dans Cursor/VSCode' },
  { name: 'moltbot_status',  category: 'projects',     description: 'Statut de Clawdbot (moltbot) — gateway, version, canaux' },
  // ── Intégrations ────────────────────────────────────────────────────────
  { name: 'sql_query',       category: 'integrations', description: 'Requête SQL SELECT sur PostgreSQL (revenue-os-postgres)' },
  { name: 'sql_execute',     category: 'integrations', description: 'Exécuter INSERT/UPDATE/DELETE sur PostgreSQL' },
  { name: 'sql_schema',      category: 'integrations', description: 'Lister les tables et schéma PostgreSQL' },
  { name: 'n8n',             category: 'integrations', description: 'Lister et déclencher des workflows N8N' },
  { name: 'generate_image',  category: 'integrations', description: 'Générer une image avec DALL-E 3 (OpenAI)' },
  { name: 'cu_screenshot',   category: 'integrations', description: 'Screenshot via Computer Use API (port 8015, claude-opus-4-6)' },
  { name: 'cu_status',       category: 'integrations', description: 'Statut et sessions Computer Use API' },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Vérifie si le serveur ruche-bridge tourne sur :8020.
 * @returns {Promise<boolean>}
 */
async function isServerUp() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);
  try {
    const res = await fetch(`${RUCHE_SERVER_URL}/health`, { signal: controller.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    clearTimeout(timer);
    return false;
  }
}

/**
 * Appel HTTP vers le serveur ruche-bridge FastAPI.
 * @param {string} toolName
 * @param {object} args
 * @returns {Promise<{success: boolean, result: string, tool: string}>}
 */
async function callViaHttp(toolName, args) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);

  try {
    const res = await fetch(`${RUCHE_SERVER_URL}/tool/${encodeURIComponent(toolName)}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ args: args ?? {} }),
      signal:  controller.signal,
    });
    clearTimeout(timer);

    const data = await res.json();
    if (data.success === false) {
      return { success: false, result: data.error ?? 'Erreur inconnue', tool: toolName };
    }
    return { success: true, result: String(data.result ?? ''), tool: toolName };
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

/**
 * Appel via subprocess python3 — fallback quand le serveur est DOWN.
 * Importe dynamiquement builtins.py et exécute l'outil.
 * @param {string} toolName
 * @param {object} args
 * @returns {Promise<{success: boolean, result: string, tool: string}>}
 */
async function callViaSubprocess(toolName, args) {
  // Script Python inline qui importe builtins et appelle l'outil
  const script = `
import sys, asyncio, json
sys.path.insert(0, '${RUCHE_CORPS_PATH}')

# Initialiser la configuration minimale avant l'import
import os
os.environ.setdefault('RUCHE_HOME', os.path.expanduser('~/.ruche'))

try:
    import tools.builtins  # déclenche l'enregistrement @tool
    from tools.registry import registry

    args = json.loads(sys.argv[1]) if len(sys.argv) > 1 else {}
    tool_name = '${toolName}'

    async def main():
        result = await registry.execute(tool_name, args)
        if 'error' in result:
            print(json.dumps({'success': False, 'error': result['error']}))
        else:
            print(json.dumps({'success': True, 'result': str(result.get('result', ''))}))

    asyncio.run(main())
except Exception as e:
    import traceback
    print(json.dumps({'success': False, 'error': str(e), 'trace': traceback.format_exc()[-800:]}))
`;

  const argsJson = JSON.stringify(args ?? {});

  const { stdout, stderr } = await execFileAsync(
    'python3',
    ['-c', script, argsJson],
    {
      timeout: SUBPROCESS_TIMEOUT_MS,
      maxBuffer: 4 * 1024 * 1024, // 4 MB
      cwd: RUCHE_CORPS_PATH,
      env: {
        ...process.env,
        PYTHONPATH: RUCHE_CORPS_PATH,
      },
    }
  );

  // Chercher la dernière ligne JSON dans stdout
  const lines = (stdout || '').trim().split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line.startsWith('{')) {
      try {
        const parsed = JSON.parse(line);
        return {
          success: parsed.success ?? true,
          result:  parsed.result ?? parsed.error ?? line,
          tool:    toolName,
        };
      } catch {
        // pas du JSON valide — continuer
      }
    }
  }

  // Aucun JSON trouvé — retourner stdout brut
  const output = stdout || stderr || '(aucune sortie)';
  return { success: true, result: output.trim(), tool: toolName };
}

// ─── API publique ─────────────────────────────────────────────────────────────

/**
 * Retourne la liste complète des outils disponibles.
 * @returns {Array<{name: string, category: string, description: string}>}
 */
export function listTools() {
  return TOOLS_REGISTRY;
}

/**
 * Appelle un outil ruche-corps par son nom.
 *
 * @param {object} params
 * @param {string} params.tool   - Nom de l'outil (ex: "shell", "web_search", "remember")
 * @param {object} [params.args] - Arguments de l'outil (ex: {command: "ls -la"})
 * @returns {Promise<{success: boolean, result: string, tool: string}>}
 *
 * @example
 *   const res = await run({ tool: 'shell', args: { command: 'ls ~/Projects' } });
 *   console.log(res.result);
 */
export async function run(params = {}) {
  const toolName = params.tool;
  const args     = params.args ?? {};

  if (!toolName) {
    return {
      success: false,
      result:  'Paramètre "tool" requis. Appelle listTools() pour voir les outils disponibles.',
      tool:    '',
    };
  }

  // Vérifier que l'outil existe dans le registre local
  const toolMeta = TOOLS_REGISTRY.find(t => t.name === toolName);
  if (!toolMeta) {
    return {
      success: false,
      result:  `Outil inconnu: "${toolName}". Outils disponibles: ${TOOLS_REGISTRY.map(t => t.name).join(', ')}`,
      tool:    toolName,
    };
  }

  // Tentative 1 : via le serveur HTTP (plus rapide, logs centralisés)
  const serverUp = await isServerUp();
  if (serverUp) {
    try {
      return await callViaHttp(toolName, args);
    } catch (httpErr) {
      // Serveur up mais erreur réseau — tomber dans le fallback subprocess
      console.warn(`[ruche-corps-bridge] HTTP failed for "${toolName}": ${httpErr.message}. Using subprocess fallback.`);
    }
  }

  // Tentative 2 : subprocess python3 (fallback)
  try {
    return await callViaSubprocess(toolName, args);
  } catch (subErr) {
    return {
      success: false,
      result:  `Erreur subprocess pour "${toolName}": ${subErr.message}`,
      tool:    toolName,
    };
  }
}
