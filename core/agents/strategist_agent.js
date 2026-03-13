/**
 * core/agents/strategist_agent.js
 * Ghost OS Ultimate — Agent Stratège
 *
 * Utilise claude-opus-4-6 pour la planification stratégique à long terme.
 * Émet des événements sur le NeuralEventBus pour la coordination inter-agents.
 */

export class StrategistAgent {
  constructor(event_bus, memory, options = {}) {
    this.event_bus = event_bus;
    this.memory    = memory;
    this.model     = options.model || 'claude-opus-4-6';
    this.queen_url = options.queen_url || 'http://localhost:8003';  // Brain layer
    this.name      = 'strategist';
  }

  async plan(goal, context = {}) {
    const prompt = this._buildPrompt(goal, context);

    let plan;
    try {
      // Appel au Brain layer (port 8003) qui gère le routing LLM
      const response = await this._callBrain(prompt);
      plan = this._parsePlan(response, goal);
    } catch (err) {
      plan = this._fallbackPlan(goal, err.message);
    }

    // Mémorisation
    await this.memory.storeEpisode({
      type:    'strategic_plan',
      agent:   this.name,
      goal:    typeof goal === 'string' ? goal : goal.description,
      context,
      plan,
      success: true,
    });

    await this.event_bus.emit('strategic.plan.created', plan);
    return plan;
  }

  _buildPrompt(goal, context) {
    return `Tu es l'architecte stratégique de Ghost OS Ultimate.

BUT : ${typeof goal === 'string' ? goal : goal.description}
CONTEXTE : ${JSON.stringify(context, null, 2)}

Crée un plan stratégique JSON avec exactement cette structure :
{
  "objectives": [{"id": "obj-1", "description": "...", "priority": 1}],
  "milestones": [{"id": "ms-1", "description": "...", "deadline_estimate": "..."}],
  "risks": [{"description": "...", "mitigation": "..."}],
  "success_factors": ["..."],
  "timeline_estimate": "..."
}

Sois précis, ambitieux et réaliste. Maximum 5 objectifs.`;
  }

  _parsePlan(raw, goal) {
    try {
      const json = raw.match(/\{[\s\S]*\}/)?.[0];
      if (json) return JSON.parse(json);
    } catch { /* fallback */ }
    return this._fallbackPlan(goal, 'parse error');
  }

  _fallbackPlan(goal, reason) {
    return {
      objectives:     [{ id: 'obj-1', description: typeof goal === 'string' ? goal : goal.description, priority: 1 }],
      milestones:     [],
      risks:          [{ description: reason, mitigation: 'Réessayer avec plus de contexte' }],
      success_factors: ['Exécution étape par étape'],
      timeline_estimate: 'À déterminer',
      _fallback: true,
    };
  }

  async _callBrain(prompt) {
    const { default: http } = await import('node:http');
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({
        mission:      prompt,
        mission_type: 'strategic',
        max_tokens:   2000,
      });
      const req = http.request({
        hostname: 'localhost',
        port:     8003,
        path:     '/think',
        method:   'POST',
        headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      }, res => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            resolve(parsed.plan || parsed.response || data);
          } catch { resolve(data); }
        });
      });
      req.on('error', reject);
      req.setTimeout(60_000, () => { req.destroy(); reject(new Error('timeout')); });
      req.write(body);
      req.end();
    });
  }
}
