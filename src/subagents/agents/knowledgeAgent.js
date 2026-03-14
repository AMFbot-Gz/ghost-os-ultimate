/**
 * src/subagents/agents/knowledgeAgent.js — Configuration du KnowledgeAgent
 *
 * Spécialisé en gestion de la connaissance.
 * Interroge et enrichit la base de connaissances de Ghost OS Ultimate.
 */

export const knowledgeAgentConfig = {
  id: "knowledge_agent",
  name: "KnowledgeAgent",
  icon: "🧠",
  color: "#8b5cf6",
  description: "Gestion de la mémoire épisodique Ghost OS, world_state, docs, embeddings",
  model: "llama3:latest",
  allowedSkills: [
    "read_file",
    "http_fetch",
    "summarize_project",
    "accessibility_reader",
    "update_world_state",
  ],
  allowedMCPs: [
    "vault_mcp.js",
    "vision_mcp.js",
    "skill_factory_mcp.js",
  ],
  systemPrompt: `Tu es KnowledgeAgent de Ghost OS Ultimate v2.0, spécialisé en gestion de la connaissance.
Tu interroges et enrichis la mémoire épisodique (couche memory :8006) et world_state.json.
Tu peux lire des fichiers, analyser des documents, résumer des projets, mettre à jour le world state.
Après chaque mission importante, tu appelles update_world_state pour consolider l'état du système.
Réponds en JSON structuré. Sois exhaustif dans l'analyse.`,
  capabilities: [
    "knowledge_query",
    "memory_update",
    "doc_analysis",
    "skill_catalog",
  ],
  maxConcurrent: 1,
  timeout: 180_000,
};
