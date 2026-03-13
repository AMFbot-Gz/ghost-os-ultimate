/**
 * src/subagents/index.js — Point d'entrée du système de sous-agents LaRuche
 *
 * Enregistre les 3 sous-agents spécialisés et exporte le manager singleton.
 *
 * Utilisation dans queen_oss.js :
 *   import { subagentManager } from './subagents/index.js';
 *   subagentManager.setDeps({ logger, broadcastHUD, runMission });
 */

import { subagentManager } from "./subagentManager.js";
import { devAgentConfig } from "./agents/devAgent.js";
import { opsAgentConfig } from "./agents/opsAgent.js";
import { knowledgeAgentConfig } from "./agents/knowledgeAgent.js";

// Enregistrement des 3 sous-agents
subagentManager.register(devAgentConfig);
subagentManager.register(opsAgentConfig);
subagentManager.register(knowledgeAgentConfig);

export { subagentManager };
export { devAgentConfig, opsAgentConfig, knowledgeAgentConfig };
