/**
 * src/subagents/agents/devAgent.js — Configuration du DevAgent
 *
 * Spécialisé en développement Node.js/JavaScript.
 * Maintient et fait évoluer le code de Ghost OS Ultimate.
 */

export const devAgentConfig = {
  id: "dev_agent",
  name: "DevAgent",
  icon: "🔧",
  color: "#3b82f6",
  description: "Maintenance et évolution du code Ghost OS Ultimate, Node.js/JS, scripts, tests",
  model: "llama3.2:3b",
  allowedSkills: [
    "run_command",
    "read_file",
    "run_shell",
    "http_fetch",
    "summarize_project",
  ],
  allowedMCPs: [
    "terminal_mcp.js",
    "os_control_mcp.js",
    "vault_mcp.js",
    "skill_factory_mcp.js",
  ],
  systemPrompt: `Tu es DevAgent de Ghost OS Ultimate v2.0, spécialisé en développement Node.js/JavaScript.
Tu maintiens et fais évoluer le code du projet Ghost OS Ultimate (Queen :3000 + 7 couches Python :8001-8007).
Tu peux lire des fichiers, exécuter des commandes git/npm/node, analyser du code.
Tu ne supprimes JAMAIS de fichiers sans confirmation explicite.
Réponds toujours en JSON structuré quand possible. Sois précis et concis.`,
  capabilities: [
    "code_review",
    "refactor",
    "test_run",
    "git_ops",
    "npm_audit",
  ],
  maxConcurrent: 2,
  timeout: 120_000,
};
