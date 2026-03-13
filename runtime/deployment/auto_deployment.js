/**
 * runtime/deployment/auto_deployment.js
 * Ghost OS Ultimate — Déploiement adaptatif automatique
 *
 * Détecte l'environnement et sélectionne le mode optimal.
 * Recommande et initialise la configuration selon les ressources disponibles.
 */

import os from 'os';
import { execSync } from 'child_process';

export class AutoDeployment {
  constructor(options = {}) {
    this.options = options;
    this._analysis = null;
  }

  async analyzeEnvironment() {
    const [gpu, disk, ollama] = await Promise.allSettled([
      this._detectGPU(),
      this._getDiskSpace(),
      this._checkOllama(),
    ]);

    this._analysis = {
      platform:    os.platform(),
      arch:        os.arch(),
      cpu_count:   os.cpus().length,
      cpu_model:   os.cpus()[0]?.model || 'unknown',
      memory_gb:   Math.round(os.totalmem() / 1024 ** 3 * 10) / 10,
      memory_free_gb: Math.round(os.freemem() / 1024 ** 3 * 10) / 10,
      disk_free_gb: disk.status === 'fulfilled' ? disk.value : null,
      gpu:          gpu.status === 'fulfilled'  ? gpu.value  : null,
      ollama:       ollama.status === 'fulfilled' ? ollama.value : { available: false },
      node_version: process.version,
      timestamp:    new Date().toISOString(),
    };

    this._analysis.recommended = this._recommend(this._analysis);
    return this._analysis;
  }

  _recommend(env) {
    const { memory_gb, cpu_count, gpu } = env;

    // Décision basée sur les ressources disponibles
    if (memory_gb >= 16 && cpu_count >= 8) {
      return {
        mode:                'ultimate',
        parallel_missions:   5,
        llm_strategist:      'llama3:latest',
        llm_worker:          'llama3.2:3b',
        llm_vision:          gpu ? 'llava:13b' : 'moondream:latest',
        perception_resolution: 'ultra',
        consciousness:       true,
        swarm:               false,  // Single machine
        note:                'Machine haute performance — Mode Ultime recommandé',
      };
    }

    if (memory_gb >= 8 && cpu_count >= 4) {
      return {
        mode:                'ultimate',
        parallel_missions:   2,
        llm_strategist:      'llama3.2:3b',
        llm_worker:          'llama3.2:3b',
        llm_vision:          'moondream:latest',
        perception_resolution: 'high',
        consciousness:       true,
        swarm:               false,
        note:                'Machine intermédiaire — Mode Ultime dégradé',
      };
    }

    return {
      mode:                'lite',
      parallel_missions:   1,
      llm_strategist:      'llama3.2:3b',
      llm_worker:          'llama3.2:3b',
      llm_vision:          'moondream:latest',
      perception_resolution: 'medium',
      consciousness:       false,
      swarm:               false,
      note:                'Machine légère — Mode Lite recommandé',
    };
  }

  async deploy(config) {
    if (!config) {
      if (!this._analysis) await this.analyzeEnvironment();
      config = this._analysis.recommended;
    }

    console.log(`\n🚀 Ghost OS Ultimate — Déploiement en mode "${config.mode}"`);
    console.log(`   ${config.note || ''}\n`);

    // Génère le fichier .env optimisé
    await this._generateEnv(config);

    // Génère agent_config.yml adapté
    await this._generateAgentConfig(config);

    console.log('✅ Configuration générée');
    return config;
  }

  async _generateEnv(config) {
    const { writeFileSync } = await import('fs');
    const lines = [
      `# Ghost OS Ultimate — Auto-générée le ${new Date().toISOString()}`,
      `# Mode: ${config.mode}`,
      ``,
      `STANDALONE_MODE=true`,
      `OLLAMA_HOST=http://localhost:11434`,
      `OLLAMA_MODEL=${config.llm_strategist}`,
      `OLLAMA_MODEL_WORKER=${config.llm_worker}`,
      `OLLAMA_MODEL_VISION=${config.llm_vision}`,
      `GHOST_OS_MODE=${config.mode}`,
      `MAX_PARALLEL_MISSIONS=${config.parallel_missions}`,
      `PERCEPTION_RESOLUTION=${config.perception_resolution}`,
      `CONSCIOUSNESS_ENABLED=${config.consciousness}`,
      `HITL_TIMEOUT_SECONDS=120`,
      `API_PORT=3000`,
      `HUD_PORT=9001`,
      ``,
      `# À remplir manuellement :`,
      `# TELEGRAM_BOT_TOKEN=`,
      `# ADMIN_TELEGRAM_ID=`,
      `# ANTHROPIC_API_KEY=`,
    ];
    writeFileSync('.env.auto', lines.join('\n'));
  }

  async _generateAgentConfig(config) {
    const { writeFileSync } = await import('fs');
    const yaml = `# Ghost OS Ultimate — agent_config auto-généré
# Mode: ${config.mode}
version: "1.0.0"

vital_loop_interval_sec: 30

ports:
  queen: 8001
  perception: 8002
  brain: 8003
  executor: 8004
  evolution: 8005
  memory: 8006
  mcp_bridge: 8007

ollama:
  base_url: "http://localhost:11434"
  models:
    strategist: "${config.llm_strategist}"
    worker: "${config.llm_worker}"
    vision: "${config.llm_vision}"
    compressor: "${config.llm_worker}"

brain:
  max_context_tokens: 8000
  compress_threshold: 6000
  max_subtasks: 5
  auto_act_on: ["low", "medium", "high"]
  hitl_required_on: []

security:
  hitl_mode: "autonomous"
  max_shell_timeout: 30
  blocked_shell_patterns:
    - "rm -rf /"
    - ":(){ :|:& };:"
    - "dd if=/dev/zero"
    - "mkfs"
    - "shutdown"
    - "reboot"
`;
    writeFileSync('agent_config.auto.yml', yaml);
  }

  async _detectGPU() {
    try {
      const out = execSync('system_profiler SPDisplaysDataType 2>/dev/null | grep -i "chipset model"', { encoding: 'utf-8', timeout: 5000 });
      return { available: true, model: out.trim().split(':').pop()?.trim() };
    } catch {
      return { available: false };
    }
  }

  async _getDiskSpace() {
    try {
      const out = execSync("df -g / | awk 'NR==2{print $4}'", { encoding: 'utf-8', timeout: 3000 });
      return parseFloat(out.trim());
    } catch {
      return null;
    }
  }

  async _checkOllama() {
    try {
      const { default: http } = await import('node:http');
      return new Promise(resolve => {
        const req = http.get('http://localhost:11434/api/tags', res => {
          let data = '';
          res.on('data', c => data += c);
          res.on('end', () => {
            try {
              const parsed = JSON.parse(data);
              resolve({
                available: true,
                models: parsed.models?.map(m => m.name) || [],
              });
            } catch { resolve({ available: true, models: [] }); }
          });
        });
        req.on('error', () => resolve({ available: false }));
        req.setTimeout(3000, () => { req.destroy(); resolve({ available: false }); });
      });
    } catch {
      return { available: false };
    }
  }

  printReport() {
    if (!this._analysis) {
      console.log('[AutoDeployment] Analyse non encore effectuée — lance analyzeEnvironment() d\'abord');
      return;
    }
    const a = this._analysis;
    const r = a.recommended;
    console.log('\n╔═══════════════════════════════════════════════╗');
    console.log('║       Ghost OS Ultimate — Rapport Système     ║');
    console.log('╚═══════════════════════════════════════════════╝');
    console.log(`  Platform   : ${a.platform} (${a.arch})`);
    console.log(`  CPU        : ${a.cpu_count} cores — ${a.cpu_model}`);
    console.log(`  RAM        : ${a.memory_gb} GB total, ${a.memory_free_gb} GB libre`);
    console.log(`  Disk libre : ${a.disk_free_gb} GB`);
    console.log(`  GPU        : ${a.gpu?.model || 'non détecté'}`);
    console.log(`  Ollama     : ${a.ollama.available ? `✅ (${a.ollama.models?.length} modèles)` : '❌'}`);
    console.log(`\n  ✅ Mode recommandé : ${r.mode.toUpperCase()}`);
    console.log(`  ${r.note}\n`);
  }
}
