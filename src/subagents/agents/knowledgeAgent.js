/**
 * src/subagents/agents/knowledgeAgent.js — Configuration du KnowledgeAgent
 *
 * Spécialisé en gestion de la connaissance.
 * Interroge et enrichit la base de connaissances de LaRuche.
 */

export const knowledgeAgentConfig = {
  id: "knowledge_agent",
  name: "KnowledgeAgent",
  icon: "🧠",
  color: "#8b5cf6",
  description: "Gestion et interrogation de la base de connaissances locale, mémoire, docs",
  model: "llama3:latest",
  allowedSkills: [
    "read_file",
    "http_fetch",
    "summarize_project",
    "accessibility_reader",
  ],
  allowedMCPs: [
    "vault_mcp.js",
    "vision_mcp.js",
    "skill_factory_mcp.js",
  ],
  systemPrompt: `Tu es KnowledgeAgent, spécialisé en gestion de la connaissance.
Tu interroges et enrichis la base de connaissances de LaRuche.
Tu peux lire des fichiers, analyser des documents, résumer des projets.
Tu maintiens la mémoire à jour et indexée.
Réponds en français. Sois exhaustif dans l'analyse.`,
  capabilities: [
    "knowledge_query",
    "memory_update",
    "doc_analysis",
    "skill_catalog",
  ],
  maxConcurrent: 1,
  timeout: 180_000,
};
