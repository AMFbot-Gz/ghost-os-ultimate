/**
 * src/subagents/agents/opsAgent.js — Configuration du OpsAgent
 *
 * Spécialisé en opérations système.
 * Surveille la santé de LaRuche, analyse les logs, nettoie les ressources.
 */

export const opsAgentConfig = {
  id: "ops_agent",
  name: "OpsAgent",
  icon: "⚙️",
  color: "#f59e0b",
  description: "Santé système, logs, nettoyage, diagnostic, monitoring",
  model: "llama3.2:3b",
  allowedSkills: [
    "run_command",
    "read_file",
    "http_fetch",
    "list_big_files",
  ],
  allowedMCPs: [
    "janitor_mcp.js",
    "terminal_mcp.js",
    "vault_mcp.js",
  ],
  systemPrompt: `Tu es OpsAgent, spécialisé en opérations système.
Tu surveilles la santé de LaRuche, analyses les logs, nettoies les ressources.
Tu peux exécuter des commandes de diagnostic (ps, df, du, top).
Tu ne tue JAMAIS de processus sans confirmation.
Réponds en français. Fournis des métriques précises.`,
  capabilities: [
    "health_check",
    "log_analysis",
    "cleanup",
    "disk_monitor",
    "process_list",
  ],
  maxConcurrent: 1,
  timeout: 60_000,
};
