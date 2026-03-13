/**
 * provider.js — Adapter LLMProvider pour agentLoop v4.1
 * Wraps model_router.js pour compatibilité avec l'interface LLMProvider d'agentLoop
 */
import { ask } from '../model_router.js';

export class LLMProvider {
  constructor(config = {}) {
    this.config = config;
    // Support config.primary.model si fourni (format agentLoop yaml)
    this.defaultModel = config?.primary?.model || null;
  }

  /**
   * Génère une réponse à partir d'un tableau de messages.
   * @param {Array<{role: string, content: string}>} messages
   * @param {{temperature?: number, timeout?: number}} opts
   */
  async generate(messages, opts = {}) {
    // Prend le dernier message utilisateur comme prompt
    const lastUser = [...messages].reverse().find(m => m.role === 'user');
    const systemMsg = messages.find(m => m.role === 'system');

    // Construit le prompt avec contexte system si présent
    let prompt = lastUser?.content || '';
    if (systemMsg) {
      prompt = `${systemMsg.content}\n\nUser: ${prompt}`;
    }

    const result = await ask(prompt, {
      role: opts.role || 'worker',
      temperature: opts.temperature ?? this.config?.temperature ?? 0.3,
      timeout: opts.timeout ?? this.config?.timeout_ms ?? 60000,
    });

    return {
      content: result.text || '',
      thought: null,
      model: result.model,
      provider: 'ollama',
      toolCalls: [],
      usage: { input_tokens: 0, output_tokens: 0 },
      success: result.success,
    };
  }
}

// Stubs de classes vides pour compatibilité avec les imports TypeScript compilés
export class Message {}
export class ToolCall {}
