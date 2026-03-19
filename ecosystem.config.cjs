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
 *  11. self-repair       — Auto-repair engine (PM2 bus + brain patches)
 *  12. night-worker      — Worker nocturne (02h-07h30 cron tasks)
 *  13. stitch-bridge     — Workflows stitch (vente/CRM/pipeline) :3006
 *  14. laruche-sync      — Sync bidirectionnel LaRuche ↔ ghost-os :3007
 *  15. pico-satellite    — Satellite PicoClaw Go lightweight agent (:8090)
 *  16. omega             — Agent auto-codeur avec contrôle total souris/clavier/apps
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
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 5000,
      max_memory_restart: '150M',
      env_production: {
        NODE_ENV: 'production',
        TELEGRAM_MODE: 'omega',
      },
      env_development: {
        NODE_ENV: 'development',
        TELEGRAM_MODE: 'omega',
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
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 3000,
      max_memory_restart: '500M',
      env_production: {
        NODE_ENV: 'production',
        STANDALONE_MODE: 'true',
        API_PORT: '3002',
        HUD_PORT: '9003',
        TELEGRAM_MODE: 'omega',
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
        TELEGRAM_MODE: 'omega',
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
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 5000,
      max_memory_restart: '2G',
      env_production: {
        PYTHONUNBUFFERED: '1',
        TELEGRAM_MODE: 'omega',
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
      max_restarts: 10,
      min_uptime: '10s',
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
      max_restarts: 10,
      min_uptime: '10s',
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
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 5000,
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
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 5000,
      max_memory_restart: '100M',
      env_production: {
        NODE_ENV: 'production',
        TELEGRAM_MODE: 'omega',
        MOLTBOT_BRIDGE_PORT: '3003',
        API_PORT: '3002',
      },
      env_development: {
        NODE_ENV: 'development',
        TELEGRAM_MODE: 'omega',
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
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 5000,
      max_memory_restart: '80M',
      cron_restart: '0 4 * * *',
      env_production: {
        NODE_ENV: 'production',
        TELEGRAM_MODE: 'omega',
        API_PORT: '3002',
      },
      env_development: {
        NODE_ENV: 'development',
        TELEGRAM_MODE: 'omega',
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
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 5000,
      max_memory_restart: '120M',
      env_production: {
        NODE_ENV: 'production',
        TELEGRAM_MODE: 'omega',
        API_PORT: '3002',
        GOALS_API_PORT: '3005',
      },
      env_development: {
        NODE_ENV: 'development',
        TELEGRAM_MODE: 'omega',
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
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 5000,
      max_memory_restart: '200M',
      env_production: {
        NODE_ENV: 'production',
        TELEGRAM_MODE: 'omega',
        MEMORY_HUB_PORT: '3004',
      },
      env_development: {
        NODE_ENV: 'development',
        TELEGRAM_MODE: 'omega',
        MEMORY_HUB_PORT: '3004',
      },
      log_file: '.laruche/logs/memory-hub.log',
      error_file: '.laruche/logs/memory-hub-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
    },

    // ── 11. Self-Repair Engine — auto-patch via PM2 bus + brain :8003 ─────────
    {
      name: 'self-repair',
      script: 'src/self-repair.js',
      interpreter: 'node',
      watch: false,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 10000,
      max_memory_restart: '150M',
      env_production: {
        NODE_ENV: 'production',
        TELEGRAM_MODE: 'omega',
        BRAIN_URL: 'http://localhost:8003',
      },
      env_development: {
        NODE_ENV: 'development',
        TELEGRAM_MODE: 'omega',
        BRAIN_URL: 'http://localhost:8003',
      },
      log_file: '.laruche/logs/self-repair.log',
      error_file: '.laruche/logs/self-repair-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
    },

    // ── 12. Night Worker — tâches cron nocturnes (02h00-07h30) ───────────────
    {
      name: 'night-worker',
      script: 'src/night-worker.js',
      interpreter: 'node',
      watch: false,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 5000,
      max_memory_restart: '150M',
      cron_restart: '0 8 * * *',           // redémarrage propre après le briefing
      env_production: {
        NODE_ENV: 'production',
        TELEGRAM_MODE: 'omega',
        BRAIN_URL: 'http://localhost:8003',
      },
      env_development: {
        NODE_ENV: 'development',
        TELEGRAM_MODE: 'omega',
        BRAIN_URL: 'http://localhost:8003',
      },
      log_file: '.laruche/logs/night-worker.log',
      error_file: '.laruche/logs/night-worker-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
    },

    // ── 13. Stitch Bridge — workflows vente/CRM :3006 ────────────────────────
    {
      name: 'stitch-bridge',
      script: 'src/stitch-bridge.js',
      interpreter: 'node',
      watch: false,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 5000,
      max_memory_restart: '100M',
      env_production: {
        NODE_ENV: 'production',
        TELEGRAM_MODE: 'omega',
        STITCH_BRIDGE_PORT: '3006',
        STITCH_URL: 'http://localhost:3010',
      },
      env_development: {
        NODE_ENV: 'development',
        TELEGRAM_MODE: 'omega',
        STITCH_BRIDGE_PORT: '3006',
        STITCH_URL: 'http://localhost:3010',
      },
      log_file: '.laruche/logs/stitch-bridge.log',
      error_file: '.laruche/logs/stitch-bridge-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
    },

    // ── 14. LaRuche Sync — bidirectionnel :3007 ───────────────────────────────
    {
      name: 'laruche-sync',
      script: 'src/laruche-sync.js',
      interpreter: 'node',
      watch: false,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 5000,
      max_memory_restart: '100M',
      env_production: {
        NODE_ENV: 'production',
        TELEGRAM_MODE: 'omega',
        LARUCHE_SYNC_PORT: '3007',
        LARUCHE_URL: 'http://localhost:3000',
      },
      env_development: {
        NODE_ENV: 'development',
        TELEGRAM_MODE: 'omega',
        LARUCHE_SYNC_PORT: '3007',
        LARUCHE_URL: 'http://localhost:3000',
      },
      log_file: '.laruche/logs/laruche-sync.log',
      error_file: '.laruche/logs/laruche-sync-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
    },

    // ── 15. PicoClaw Gateway — agent IA Go, Telegram natif ───────────────────
    // Remplace jarvis-bot (Python) + pico-satellite (JS).
    // PicoClaw gère Telegram, LLM (GLM via Ollama), tools et MCP directement.
    // Config : ~/.picoclaw/config.json | Workspace : ~/ghost-os-ultimate/AGENTS.md
    {
      name: 'picoclaw-gateway',
      script: '/usr/local/bin/picoclaw',
      args: 'gateway',
      watch: false,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 5000,
      max_memory_restart: '150M',
      env: {
        PICOCLAW_HOME: '/Users/wiaamhadara/.picoclaw',
      },
      log_file: '.laruche/logs/picoclaw-gateway.log',
      error_file: '.laruche/logs/picoclaw-gateway-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
    },

    // ── 16. Omega — Agent auto-codeur, contrôle total macOS ──────────────────
    {
      name: 'omega',
      script: 'src/omega/omega_daemon.py',
      interpreter: 'python3',
      watch: false,
      autorestart: true,
      max_restarts: 5,
      min_uptime: '10s',
      restart_delay: 10000,
      max_memory_restart: '300M',
      env_production: {
        PYTHONUNBUFFERED: '1',
        OLLAMA_HOST: 'http://localhost:11434',
        OLLAMA_MODEL: 'ghost-os-architect:latest',
      },
      env_development: {
        PYTHONUNBUFFERED: '1',
        OLLAMA_HOST: 'http://localhost:11434',
        OLLAMA_MODEL: 'ghost-os-architect:latest',
      },
      log_file: '.laruche/logs/omega.log',
      error_file: '.laruche/logs/omega-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
    },

  ],
};
