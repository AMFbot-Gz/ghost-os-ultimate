/**
 * ecosystem.config.cjs — Jarvis OS Unified PM2 Config (CJS)
 * Démarrage : pm2 start ecosystem.config.cjs --env production
 *
 * Processus :
 *   1. jarvis-gateway    — Bot Telegram UNIQUE (:gateway)
 *   2. queen-node        — API REST Node.js (:3002)
 *   3. agents-python     — 16 agents FastAPI Python (:8001-:8019)
 *   4. ollama-watchdog   — Surveillance Ollama (60s interval)
 *   5. ruche-bridge      — Bridge vers ruche-corps (:8020)
 *   6. pico-compressor   — MCP compresseur de contexte
 *   7. moltbot-bridge    — Passerelle multi-canaux Moltbot (:3003)
 *   8. vital-loop        — Boucle vitale 24/7 (health + alertes Telegram)
 *   9. goals-scheduler   — Scheduler goals autonomes (:3005)
 *  10. memory-hub        — Hub mémoire unifié (:3004)
 *
 * RÈGLE : UN SEUL processus écoute Telegram = jarvis-gateway
 */

module.exports = {
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
        TELEGRAM_MODE: 'gateway',
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
        TELEGRAM_MODE: 'gateway',
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
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
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
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },

    // ── 7. Moltbot Bridge — passerelle multi-canaux :3003 ───────────────────
    {
      name: 'moltbot-bridge',
      script: 'src/moltbot-bridge.js',
      interpreter: 'node',
      watch: false,
      autorestart: true,
      restart_delay: 5000,
      max_memory_restart: '100M',
      env_production: {
        NODE_ENV: 'production',
        TELEGRAM_MODE: 'gateway',
        MOLTBOT_BRIDGE_PORT: '3003',
        API_PORT: '3002',
      },
      env_development: {
        NODE_ENV: 'development',
        TELEGRAM_MODE: 'gateway',
        MOLTBOT_BRIDGE_PORT: '3003',
        API_PORT: '3002',
      },
      log_file: '.laruche/logs/moltbot-bridge.log',
      error_file: '.laruche/logs/moltbot-bridge-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
    },

    // ── 8. Vital Loop — boucle santé 24/7 ───────────────────────────────────
    {
      name: 'vital-loop',
      script: 'src/vital-loop.js',
      interpreter: 'node',
      watch: false,
      autorestart: true,
      restart_delay: 5000,
      max_memory_restart: '80M',
      cron_restart: '0 4 * * *',
      env_production: {
        NODE_ENV: 'production',
        TELEGRAM_MODE: 'gateway',
        API_PORT: '3002',
      },
      env_development: {
        NODE_ENV: 'development',
        TELEGRAM_MODE: 'gateway',
        API_PORT: '3002',
      },
      log_file: '.laruche/logs/vital-loop.log',
      error_file: '.laruche/logs/vital-loop-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
    },

    // ── 9. Goals Scheduler — scheduler autonome :3005 ───────────────────────
    {
      name: 'goals-scheduler',
      script: 'src/goals-scheduler.js',
      interpreter: 'node',
      watch: false,
      autorestart: true,
      restart_delay: 5000,
      max_memory_restart: '120M',
      env_production: {
        NODE_ENV: 'production',
        TELEGRAM_MODE: 'gateway',
        API_PORT: '3002',
        GOALS_API_PORT: '3005',
      },
      env_development: {
        NODE_ENV: 'development',
        TELEGRAM_MODE: 'gateway',
        API_PORT: '3002',
        GOALS_API_PORT: '3005',
      },
      log_file: '.laruche/logs/goals-scheduler.log',
      error_file: '.laruche/logs/goals-scheduler-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
    },

    // ── 10. Memory Hub — hub mémoire unifié :3004 ────────────────────────────
    {
      name: 'memory-hub',
      script: 'src/memory-hub.js',
      interpreter: 'node',
      watch: false,
      autorestart: true,
      restart_delay: 5000,
      max_memory_restart: '200M',
      env_production: {
        NODE_ENV: 'production',
        TELEGRAM_MODE: 'gateway',
        MEMORY_HUB_PORT: '3004',
      },
      env_development: {
        NODE_ENV: 'development',
        TELEGRAM_MODE: 'gateway',
        MEMORY_HUB_PORT: '3004',
      },
      log_file: '.laruche/logs/memory-hub.log',
      error_file: '.laruche/logs/memory-hub-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
    },
  ],
};
