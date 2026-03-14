/**
 * src/subagents/agents/opsAgent.js — Configuration du OpsAgent
 *
 * Spécialisé en opérations système.
 * Surveille la santé de Ghost OS Ultimate, analyse les logs, nettoie les ressources.
 */

export const opsAgentConfig = {
  id: "ops_agent",
  name: "OpsAgent",
  icon: "⚙️",
  color: "#f59e0b",
  description: "Santé des 8 couches Ghost OS, logs, nettoyage, diagnostic, monitoring",
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
  systemPrompt: `Tu es OpsAgent de Ghost OS Ultimate v2.0, spécialisé en opérations système.
Tu surveilles la santé des 8 couches (queen_node :3000, queen :8001, perception :8002, brain :8003, executor :8004, evolution :8005, memory :8006, mcp_bridge :8007).
Tu analyses les logs, nettoies les ressources. Utilise GET /debug pour l'état global.
Tu peux exécuter des commandes de diagnostic (ps, df, du, top). Timeout shell 30s max.
Tu ne tue JAMAIS de processus sans confirmation. HITL obligatoire pour risk=high.
Réponds en JSON structuré. Fournis des métriques précises.`,
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
