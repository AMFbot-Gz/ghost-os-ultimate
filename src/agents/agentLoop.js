/**
 * agentLoop.js — LaRuche Agent Loop v4.1
 * Converti de TypeScript vers JavaScript pur (pas de build step requis)
 * fix(C4): HITL activé avec TOOL_RISK_MAP + requestHITL()
 * fix(C5): chemin config corrigé configuration/agents/ → config/agents/
 */

import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
import { parse as parseYaml } from "../utils/yaml.js";
import { LLMProvider } from "../llm/provider.js";
import { ToolRouter } from "../tools/toolRouter.js";
import { buildSystemPrompt } from "../context/agentIdentity.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../../");

// --- fix(C4): TOOL_RISK_MAP --------------------------------------------------
const TOOL_RISK_MAP = {
  'pw.screenshot':   0.1,
  'pw.extract':      0.1,
  'getPosition':     0.1,
  'calibrate':       0.1,
  'pw.goto':         0.2,
  'pw.launch':       0.2,
  'os.openApp':      0.2,
  'os.focusApp':     0.2,
  'moveMouse':       0.2,
  'scroll':          0.3,
  'pw.press':        0.3,
  'pw.click':        0.4,
  'pw.fill':         0.4,
  'click':           0.4,
  'typeText':        0.4,
  'execSafe':        0.7,
  'run_command':     0.9,
};

function getToolRisk(toolName) {
  return TOOL_RISK_MAP[toolName] ?? 0.5;
}

async function requestHITL(toolName, args, threshold, timeoutMs) {
  timeoutMs = timeoutMs ?? parseInt(process.env.HITL_TIMEOUT_SECONDS || '60') * 1000;
  const risk = getToolRisk(toolName);
  if (risk < threshold) return true; // approbation automatique

  console.warn(`[HITL] Outil "${toolName}" risque ${risk.toFixed(1)} ≥ seuil ${threshold.toFixed(1)} — en attente d'approbation`);

  if (process.env.HITL_AUTO_APPROVE === 'true') return true;
  if (process.env.HITL_AUTO_REJECT === 'true') return false;

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      console.warn(`[HITL] Timeout (${timeoutMs}ms) pour "${toolName}" — auto-rejet`);
      resolve(false);
    }, timeoutMs);

    process.once('laruche:hitl_response', (approved) => {
      clearTimeout(timer);
      resolve(approved);
    });
  });
}

// --- Implementation ----------------------------------------------------------

class AgentLoop {
  constructor(agentName) {
    this.agentName = agentName;
    this.sessionId = randomUUID();
    this.messages = [];
    this.config = this.loadConfig(agentName);
    this.provider = new LLMProvider(this.config.llm || {});
    this.toolRouter = new ToolRouter({
      allowed: this.config.allowed_tools || [],
      refused: this.config.refused_tools || [],
    });
  }

  loadConfig(name) {
    // fix(C5): chemin corrigé configuration/agents/ → config/agents/
    const configPath = join(ROOT, `config/agents/${name}.yaml`);
    if (!existsSync(configPath)) {
      throw new Error(`Agent configuration not found: config/agents/${name}.yaml`);
    }
    return parseYaml(readFileSync(configPath, "utf-8"));
  }

  buildSystemPrompt() {
    // Dériver le rôle depuis le nom de l'agent (operator → operator, computer-use → computer-use)
    const role = this.agentName || "operator";
    // Contexte additionnel depuis la config YAML
    const extra = this.config.soul ? `Âme de cet agent: ${this.config.soul}` : "";
    return buildSystemPrompt(role, extra);
  }

  async run(userInput, opts = {}) {
    this.messages = [
      { role: "system", content: this.buildSystemPrompt() },
      { role: "user", content: userInput },
    ];

    let iterations = 0;
    let toolCallsCount = 0;
    const maxIterations = this.config.loop?.max_iterations || 10;
    const maxToolCalls = this.config.loop?.max_tool_calls || 20;
    const hitlThreshold = this.config.loop?.hitl_threshold ?? 0.7;
    const retryOnError = this.config.loop?.retry_on_error || 3;

    while (iterations < maxIterations) {
      iterations++;
      opts.onIteration?.(iterations);

      try {
        const response = await this.provider.generate(this.messages, {
          temperature: this.config.llm?.temperature || 0.7,
          timeout: this.config.llm?.timeout_ms || 60000,
        });

        if (response.thought && this.config.loop?.thought_chain) {
          opts.onThought?.(response.thought);
        }

        if (response.content) {
          opts.onToken?.(response.content);
          this.messages.push({ role: "assistant", content: response.content });
        }

        if (!response.toolCalls || response.toolCalls.length === 0) {
          return {
            sessionId: this.sessionId,
            response: response.content || "",
            iterations,
            tool_calls_count: toolCallsCount,
            status: "completed",
          };
        }

        // fix(C4): vérification HITL avant chaque appel d'outil
        for (const call of response.toolCalls) {
          toolCallsCount++;
          if (toolCallsCount > maxToolCalls) break;

          opts.onToolCall?.(call.name, call.args);

          const approved = await requestHITL(call.name, call.args, hitlThreshold);

          let toolResult;
          if (!approved) {
            toolResult = {
              success: false,
              error: `HITL_REJECTED: L'utilisateur a refusé l'exécution de "${call.name}". Propose une approche plus sûre.`,
            };
            console.warn(`[HITL] Rejet injecté comme résultat pour "${call.name}"`);
          } else {
            toolResult = await this.toolRouter.call(call.name, call.args);
          }

          this.messages.push({
            role: "tool",
            toolCallId: call.id,
            content: JSON.stringify(toolResult),
          });
        }

      } catch (error) {
        if (iterations >= retryOnError) {
          return {
            sessionId: this.sessionId,
            response: "",
            iterations,
            tool_calls_count: toolCallsCount,
            status: "error",
            error: error.message,
          };
        }
        console.warn(`[AgentLoop] Iteration ${iterations} failed, retrying...`);
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    return {
      sessionId: this.sessionId,
      response: "Max iterations reached.",
      iterations,
      tool_calls_count: toolCallsCount,
      status: "max_iterations",
    };
  }
}

/**
 * Point d'entrée principal pour lancer un agent.
 */
export async function runAgentLoop(opts) {
  const loop = new AgentLoop(opts.agentName);
  return await loop.run(opts.userInput, opts);
}
