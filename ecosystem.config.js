/**
 * ecosystem.config.js — Jarvis OS Unified PM2 Config
 * Démarrage : pm2 start ecosystem.config.js --env production
 *
 * Processus :
 *   1. jarvis-gateway    — Bot Telegram UNIQUE (:gateway)
 *   2. queen-node        — API REST Node.js (:3002)
 *   3. agents-python     — 16 agents FastAPI Python (:8001-:8019)
 *   4. ollama-watchdog   — Surveillance Ollama (60s interval)
 *   5. ruche-bridge      — Bridge vers ruche-corps (:8020)
 *   6. pico-compressor   — MCP compresseur de contexte
 *
 * RÈGLE : UN SEUL processus écoute Telegram = jarvis-gateway
 * queen-node utilise TELEGRAM_MODE=gateway (Telegraf désactivé)
 */

export default {
  apps: [
    // ── 1. Jarvis Gateway — Bot Telegram UNIQUE ─────────────────────────────
    {
      name: 'jarvis-gateway',
      script: 'src/jarvis-gateway.js',
      interpreter: 'node',
      watch: false,
      autorestart: true,
      restart_delay: 5000,
      max_memory_restart: '150M',
      env_production: {
        NODE_ENV: 'production',
        TELEGRAM_MODE: 'gateway',
      },
      env_development: {
        NODE_ENV: 'development',
        TELEGRAM_MODE: 'gateway',
      },
      log_file: '.laruche/logs/gateway.log',
      error_file: '.laruche/logs/gateway-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
    },

    // ── 2. Queen Node.js — API REST :3002 ───────────────────────────────────
    {
      name: 'queen-node',
      script: 'src/queen_oss.js',
      interpreter: 'node',
      watch: false,
      autorestart: true,
      restart_delay: 3000,
      max_memory_restart: '500M',
      env_production: {
        NODE_ENV: 'production',
        STANDALONE_MODE: 'true',
        API_PORT: '3002',
        HUD_PORT: '9003',
        TELEGRAM_MODE: 'gateway',    // ← Telegraf désactivé — gateway gère Telegram
        GHOST_OS_MODE: 'ultimate',
        LLM_TIMEOUT_MS: '30000',
        LLM_GLOBAL_TIMEOUT_MS: '45000',
        QUEEN_MAX_PARALLEL: '3',
      },
      env_development: {
        NODE_ENV: 'development',
        STANDALONE_MODE: 'true',
        API_PORT: '3002',
        HUD_PORT: '9003',
        TELEGRAM_MODE: 'gateway',
        GHOST_OS_MODE: 'ultimate',
        LLM_TIMEOUT_MS: '30000',
        LLM_GLOBAL_TIMEOUT_MS: '45000',
        LOG_LEVEL: 'debug',
      },
      log_file: '.laruche/logs/queen.log',
      error_file: '.laruche/logs/queen-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
    },

    // ── 3. Agents Python — 16 couches FastAPI :8001-:8019 ───────────────────
    {
      name: 'agents-python',
      script: 'scripts/start-agents.sh',
      interpreter: 'bash',
      watch: false,
      autorestart: true,
      restart_delay: 5000,
      max_memory_restart: '2G',
      env_production: {
        PYTHONUNBUFFERED: '1',
        TELEGRAM_MODE: 'gateway',    // ← queen.py polling désactivé
      },
      log_file: 'agent/logs/agents-startup.log',
      error_file: 'agent/logs/agents-startup-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
    },

    // ── 4. Ollama Watchdog — surveillance toutes les 60s ────────────────────
    {
      name: 'ollama-watchdog',
      script: 'scripts/ollama-watchdog.sh',
      interpreter: 'bash',
      watch: false,
      autorestart: true,
      restart_delay: 10000,
      max_memory_restart: '30M',
      log_file: '.laruche/logs/ollama-watchdog.log',
      error_file: '.laruche/logs/ollama-watchdog-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },

    // ── 5. Ruche-corps Bridge — outils Python :8020 ─────────────────────────
    {
      name: 'ruche-bridge',
      script: 'agent/ruche_bridge_server.py',
      interpreter: 'python3',
      watch: false,
      autorestart: true,
      restart_delay: 5000,
      max_memory_restart: '200M',
      log_file: 'agent/logs/ruche_bridge.log',
      error_file: 'agent/logs/ruche_bridge-error.log',
    },

    // ── 6. MCP Compressor ───────────────────────────────────────────────────
    {
      name: 'pico-compressor',
      script: 'mcp_servers/mcp-compressor/index.js',
      watch: false,
      autorestart: true,
      max_memory_restart: '100M',
      log_file: '.laruche/logs/compressor.log',
      error_file: '.laruche/logs/compressor-error.log',
    },
  ],
};
