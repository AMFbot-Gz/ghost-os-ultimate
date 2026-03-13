/**
 * agentLoop.ts — LaRuche Agent Loop v4.1
 * fix(C4): HITL activé avec TOOL_RISK_MAP + requestHITL()
 * fix(C5): chemin config corrigé configuration/agents/ → config/agents/
 */

import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
import { parse as parseYaml } from "../utils/yaml.js";
import { LLMProvider, Message, ToolCall } from "../llm/provider.js";
import { ToolRouter } from "../tools/toolRouter.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../../");

// --- Types -------------------------------------------------------------------

export interface AgentConfig {
  description: string;
  soul: string;
  llm: {
    primary: { provider: string; model: string };
    fallback: { provider: string; model: string };
    temperature: number;
    top_p: number;
    streaming: boolean;
    timeout_ms: number;
  };
  loop: {
    max_iterations: number;
    max_tool_calls: number;
    hitl_threshold: number;
    thought_chain?: boolean;
    vision_limit?: number;
    retry_on_error: number;
  };
  allowed_tools: string[];
  refused_tools: string[];
  memory: {
    load_global: boolean;
    load_agent_specific: boolean;
    max_entries: number;
  };
}

export interface AgentResponse {
  sessionId: string;
  response: string;
  iterations: number;
  tool_calls_count: number;
  status: "completed" | "max_iterations" | "error" | "interrupted";
  error?: string;
}

// --- fix(C4): TOOL_RISK_MAP --------------------------------------------------
// Score 0.0–1.0: risque associé à chaque outil (au-delà de hitl_threshold = HITL requis)

const TOOL_RISK_MAP: Record<string, number> = {
  // Lecture seule — risque minimal
  'pw.screenshot':   0.1,
  'pw.extract':      0.1,
  'getPosition':     0.1,
  'calibrate':       0.1,
  // Navigation — risque faible
  'pw.goto':         0.2,
  'pw.launch':       0.2,
  'os.openApp':      0.2,
  'os.focusApp':     0.2,
  'moveMouse':       0.2,
  'scroll':          0.3,
  'pw.press':        0.3,
  // Interaction UI — risque moyen
  'pw.click':        0.4,
  'pw.fill':         0.4,
  'click':           0.4,
  'typeText':        0.4,
  // Terminal — risque élevé
  'execSafe':        0.7,
  // Fichiers et système — risque très élevé
  'run_command':     0.9,
};

function getToolRisk(toolName: string): number {
  return TOOL_RISK_MAP[toolName] ?? 0.5;
}

async function requestHITL(
  toolName: string,
  args: any,
  threshold: number,
  timeoutMs: number = parseInt(process.env.HITL_TIMEOUT_SEC || '60') * 1000
): Promise<boolean> {
  const risk = getToolRisk(toolName);
  if (risk < threshold) return true; // approbation automatique

  console.warn(`[HITL] Outil "${toolName}" risque ${risk.toFixed(1)} ≥ seuil ${threshold.toFixed(1)} — en attente d'approbation`);

  if (process.env.HITL_AUTO_APPROVE === 'true') return true;
  if (process.env.HITL_AUTO_REJECT === 'true') return false;

  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      console.warn(`[HITL] Timeout (${timeoutMs}ms) pour "${toolName}" — auto-rejet`);
      resolve(false);
    }, timeoutMs);

    process.once('laruche:hitl_response' as any, (approved: boolean) => {
      clearTimeout(timer);
      resolve(approved);
    });
  });
}

// --- Implementation ----------------------------------------------------------

class AgentLoop {
  private config: AgentConfig;
  private provider: LLMProvider;
  private toolRouter: ToolRouter;
  private messages: Message[] = [];
  private sessionId: string;

  constructor(agentName: string) {
    this.sessionId = randomUUID();
    this.config = this.loadConfig(agentName);
    this.provider = new LLMProvider(this.config.llm);
    this.toolRouter = new ToolRouter({
      allowed: this.config.allowed_tools,
      refused: this.config.refused_tools
    });
  }

  private loadConfig(name: string): AgentConfig {
    // fix(C5): chemin corrigé configuration/agents/ → config/agents/
    const configPath = join(ROOT, `config/agents/${name}.yaml`);
    if (!existsSync(configPath)) {
      throw new Error(`Agent configuration not found: config/agents/${name}.yaml`);
    }
    return parseYaml(readFileSync(configPath, "utf-8")) as AgentConfig;
  }

  private buildSystemPrompt(): string {
    return `You are an autonomous AI agent part of the LaRuche swarm.
Agent Identity: ${this.config.description}
Core Soul: ${this.config.soul}
Current Time: ${new Date().toISOString()}
Working Directory: ${ROOT}

RULES:
1. Use tools whenever necessary to achieve the goal.
2. If a tool fails, analyze the error and try a different approach.
3. Keep thoughts concise but clear.
4. You are 100% local, no external APIs unless via tools.`.trim();
  }

  async run(userInput: string, opts: any = {}): Promise<AgentResponse> {
    this.messages = [
      { role: "system", content: this.buildSystemPrompt() },
      { role: "user", content: userInput }
    ];

    let iterations = 0;
    let toolCallsCount = 0;

    while (iterations < this.config.loop.max_iterations) {
      iterations++;
      opts.onIteration?.(iterations);

      try {
        const response = await this.provider.generate(this.messages, {
          temperature: this.config.llm.temperature,
          timeout: this.config.llm.timeout_ms
        });

        if (response.thought && this.config.loop.thought_chain) {
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
            status: "completed"
          };
        }

        // fix(C4): vérification HITL avant chaque appel d'outil
        for (const call of response.toolCalls) {
          toolCallsCount++;
          if (toolCallsCount > this.config.loop.max_tool_calls) break;

          opts.onToolCall?.(call.name, call.args);

          // Vérifier le risque de l'outil
          const approved = await requestHITL(
            call.name,
            call.args,
            this.config.loop.hitl_threshold
          );

          let toolResult: any;
          if (!approved) {
            // Injection du rejet comme résultat d'outil — le LLM peut proposer une alternative
            toolResult = {
              success: false,
              error: `HITL_REJECTED: L'utilisateur a refusé l'exécution de "${call.name}". Propose une approche plus sûre.`
            };
            console.warn(`[HITL] Rejet injecté comme résultat pour "${call.name}"`);
          } else {
            toolResult = await this.toolRouter.call(call.name, call.args);
          }

          this.messages.push({
            role: "tool",
            toolCallId: call.id,
            content: JSON.stringify(toolResult)
          });
        }

      } catch (error: any) {
        if (iterations >= this.config.loop.retry_on_error) {
          return {
            sessionId: this.sessionId,
            response: "",
            iterations,
            tool_calls_count: toolCallsCount,
            status: "error",
            error: error.message
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
      status: "max_iterations"
    };
  }
}

export async function runAgentLoop(opts: {
  agentName: string;
  userInput: string;
  onToken?: (t: string) => void;
  onToolCall?: (tool: string, args: any) => void;
  onThought?: (t: string) => void;
  onIteration?: (n: number) => void;
}) {
  const loop = new AgentLoop(opts.agentName);
  return await loop.run(opts.userInput, opts);
}
