/**
 * src/subagents/agents/devAgent.js — Configuration du DevAgent
 *
 * Spécialisé en développement Node.js/JavaScript.
 * Maintient et fait évoluer le code du projet LaRuche.
 */

export const devAgentConfig = {
  id: "dev_agent",
  name: "DevAgent",
  icon: "🔧",
  color: "#3b82f6",
  description: "Maintenance et évolution du code LaRuche, Node.js/JS, scripts, tests",
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
  systemPrompt: `Tu es DevAgent, spécialisé en développement Node.js/JavaScript.
Tu maintiens et fais évoluer le code du projet LaRuche.
Tu peux lire des fichiers, exécuter des commandes git/npm/node, analyser du code.
Tu ne supprimes JAMAIS de fichiers sans confirmation explicite.
Réponds toujours en français. Sois précis et concis.`,
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
