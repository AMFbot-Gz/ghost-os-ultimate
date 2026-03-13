/**
 * provider.ts - Provider-agnostic LLM client for LaRuche
 *
 * Supported now: Ollama (local)
 * Ready for: Anthropic, OpenAI, Kimi, OpenRouter (env-gated)
 */

import { AgentConfig } from "../agents/agentLoop.js";

// --- Types -------------------------------------------------------------------

export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  args: any;
}

export interface LLMResponse {
  content: string;
  thought?: string;
  model: string;
  provider: string;
  toolCalls?: ToolCall[];
  usage?: { input_tokens: number; output_tokens: number };
}

interface ProviderConfig {
  host?: string;
  apiKey?: string;
  baseUrl?: string;
  default_model?: string;
  timeout_ms: number;
  active?: string;
}

// --- Provider Resolution -----------------------------------------------------

function expandEnv(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_, expr) => {
    const [varName, defaultVal] = expr.split(":-");
    return process.env[varName] ?? defaultVal ?? "";
  });
}

export class LLMProvider {
  private config: any;

  constructor(config: any) {
    this.config = config;
  }

  async generate(messages: Message[], options: { temperature?: number; timeout?: number } = {}): Promise<LLMResponse> {
    const { provider, model } = this.config.primary;

    if (provider === "ollama") {
      return this.callOllama(messages, model, options);
    }

    throw new Error(`Provider not implemented: ${provider}`);
  }

  private async callOllama(messages: Message[], model: string, options: any): Promise<LLMResponse> {
    const host = process.env.OLLAMA_HOST || "http://localhost:11434";
    const startTime = Date.now();

    const response = await fetch(`${host}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: messages.map(m => ({
          role: m.role,
          content: m.content,
          tool_call_id: m.toolCallId
        })),
        stream: false,
        options: {
          temperature: options.temperature ?? 0.7,
        }
      }),
      signal: AbortSignal.timeout(options.timeout || 30000)
    });

    if (!response.ok) {
      throw new Error(`Ollama error: ${response.statusText}`);
    }

    const data = await response.json();
    const message = data.message;

    // Detect thought tags if present
    let content = message.content || "";
    let thought: string | undefined;
    const thoughtMatch = content.match(/<thought>([\s\S]*?)<\/thought>/);
    if (thoughtMatch) {
      thought = thoughtMatch[1].trim();
      content = content.replace(/<thought>[\s\S]*?<\/thought>/, "").trim();
    }

    return {
      content,
      thought,
      model: data.model,
      provider: "ollama",
      toolCalls: message.tool_calls?.map((tc: any) => ({
        id: tc.id || `call_${Date.now()}`,
        name: tc.function.name,
        args: tc.function.arguments
      })),
      usage: {
        input_tokens: data.prompt_eval_count || 0,
        output_tokens: data.eval_count || 0
      }
    };
  }
}
