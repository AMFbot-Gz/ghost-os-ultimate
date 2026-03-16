/**
 * ecosystem.config.js — PM2 Process Manager Config
 *
 * Modes:
 *   laruche start --headless → queen + watcher only
 *   laruche start            → + dashboard
 *   laruche start --full     → + HUD Electron
 *
 * LARUCHE_MODE=low|balanced|high → performance profile
 */

const MODE = process.env.LARUCHE_MODE || "balanced";

const memoryLimits = {
  low:      { queen: "200M", hud: "100M", dashboard: "100M", watcher: "30M" },
  balanced: { queen: "500M", hud: "150M", dashboard: "200M", watcher: "50M" },
  high:     { queen: "1G",   hud: "250M", dashboard: "400M", watcher: "50M" },
};

const mem = memoryLimits[MODE] || memoryLimits.balanced;

export default {
  apps: [
    // ── Core (always started) ───────────────────────────────────────────────
    {
      name: "ghost-queen",
      script: "src/queen_oss.js",            // ← canonical entry point
      watch: false,
      restart_delay: 3000,
      max_memory_restart: mem.queen,
      env_production: {
        NODE_ENV: "production",
        PORT: 3000,
        API_PORT: 3000,
        HUD_PORT: 9001,
        STANDALONE_MODE: "false",
        HITL_AUTO_APPROVE: "true",
        LARUCHE_MODE: MODE,
        QUEEN_MAX_PARALLEL: 3,
        LLM_TIMEOUT_MS: 90000,
        SELFDEV_TIMEOUT_MS: 30000,
      },
      env_development: {
        NODE_ENV: "development",
        PORT: 3000,
        API_PORT: 3000,
        HUD_PORT: 9001,
        STANDALONE_MODE: "false",
        HITL_AUTO_APPROVE: "true",
        LARUCHE_MODE: "balanced",
        LOG_LEVEL: "debug",
        QUEEN_MAX_PARALLEL: 3,
        LLM_TIMEOUT_MS: 90000,
        SELFDEV_TIMEOUT_MS: 30000,
      },
      log_file: ".laruche/logs/queen.log",
      error_file: ".laruche/logs/queen-error.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      merge_logs: true,
    },
    {
      name: "ghost-watcher",
      script: "src/watcher.js",
      max_memory_restart: mem.watcher,
      log_file: ".laruche/logs/watcher.log",
      error_file: ".laruche/logs/watcher-error.log",
      merge_logs: true,
    },
    // ── Dashboard (started unless --headless) ───────────────────────────────
    {
      name: "ghost-dashboard",
      script: "interfaces/dashboard/server.js",
      max_memory_restart: mem.dashboard,
      env_production: { NODE_ENV: "production", LARUCHE_MODE: MODE },
      log_file: ".laruche/logs/dashboard.log",
      error_file: ".laruche/logs/dashboard-error.log",
      merge_logs: true,
    },
    // ── HUD Electron (started only with --full) ─────────────────────────────
    {
      name: "ghost-hud",
      script: "interfaces/hud/main.js",
      interpreter: "electron",
      max_memory_restart: mem.hud,
      log_file: ".laruche/logs/hud.log",
      error_file: ".laruche/logs/hud-error.log",
      merge_logs: true,
    },
    // ── PICO extensions ──────────────────────────────────────────────────────
    { name: 'pico-compressor', script: 'mcp_servers/mcp-compressor/index.js', watch: false, autorestart: true },
    { name: 'pico-context-manager', script: 'mcp_servers/mcp-context-manager/index.js', watch: false, autorestart: true },
    // ── Python agents — 16 couches (Phases 1-19) ────────────────────────────
    // Couches fondamentales (Phases 1-7)
    { name: 'ghost-memory',      script: 'agent/memory.py',      interpreter: 'python3', watch: false, autorestart: true, cwd: './', max_memory_restart: '150M', log_file: 'agent/logs/memory.log',      error_file: 'agent/logs/memory-error.log' },
    { name: 'ghost-brain',       script: 'agent/brain.py',       interpreter: 'python3', watch: false, autorestart: true, cwd: './', max_memory_restart: '400M', log_file: 'agent/logs/brain.log',       error_file: 'agent/logs/brain-error.log' },
    { name: 'ghost-perception',  script: 'agent/perception.py',  interpreter: 'python3', watch: false, autorestart: true, cwd: './', max_memory_restart: '200M', log_file: 'agent/logs/perception.log',  error_file: 'agent/logs/perception-error.log' },
    { name: 'ghost-executor',    script: 'agent/executor.py',    interpreter: 'python3', watch: false, autorestart: true, cwd: './', max_memory_restart: '150M', log_file: 'agent/logs/executor.log',    error_file: 'agent/logs/executor-error.log' },
    { name: 'ghost-evolution',   script: 'agent/evolution.py',   interpreter: 'python3', watch: false, autorestart: true, cwd: './', max_memory_restart: '200M', log_file: 'agent/logs/evolution.log',   error_file: 'agent/logs/evolution-error.log' },
    { name: 'ghost-mcp-bridge',  script: 'agent/mcp_bridge.py',  interpreter: 'python3', watch: false, autorestart: true, cwd: './', max_memory_restart: '100M', log_file: 'agent/logs/mcp_bridge.log',  error_file: 'agent/logs/mcp_bridge-error.log' },
    // Phases 10-15
    { name: 'ghost-planner',     script: 'agent/planner.py',     interpreter: 'python3', watch: false, autorestart: true, cwd: './', max_memory_restart: '150M', log_file: 'agent/logs/planner.log',     error_file: 'agent/logs/planner-error.log' },
    { name: 'ghost-learner',     script: 'agent/learner.py',     interpreter: 'python3', watch: false, autorestart: true, cwd: './', max_memory_restart: '150M', log_file: 'agent/logs/learner.log',     error_file: 'agent/logs/learner-error.log' },
    { name: 'ghost-goals',       script: 'agent/goals.py',       interpreter: 'python3', watch: false, autorestart: true, cwd: './', max_memory_restart: '100M', log_file: 'agent/logs/goals.log',       error_file: 'agent/logs/goals-error.log' },
    { name: 'ghost-pipeline',    script: 'agent/pipeline.py',    interpreter: 'python3', watch: false, autorestart: true, cwd: './', max_memory_restart: '100M', log_file: 'agent/logs/pipeline.log',    error_file: 'agent/logs/pipeline-error.log' },
    { name: 'ghost-miner',       script: 'agent/miner.py',       interpreter: 'python3', watch: false, autorestart: true, cwd: './', max_memory_restart: '150M', log_file: 'agent/logs/miner.log',       error_file: 'agent/logs/miner-error.log' },
    // Phases 16-19
    { name: 'ghost-swarm',       script: 'agent/swarm_router.py',       interpreter: 'python3', watch: false, autorestart: true, cwd: './', max_memory_restart: '150M', log_file: 'agent/logs/swarm.log',       error_file: 'agent/logs/swarm-error.log' },
    { name: 'ghost-validator',   script: 'agent/validator.py',          interpreter: 'python3', watch: false, autorestart: true, cwd: './', max_memory_restart: '100M', log_file: 'agent/logs/validator.log',   error_file: 'agent/logs/validator-error.log' },
    { name: 'ghost-computer-use',script: 'agent/computer_use.py',       interpreter: 'python3', watch: false, autorestart: true, cwd: './', max_memory_restart: '200M', log_file: 'agent/logs/computer_use.log',error_file: 'agent/logs/computer_use-error.log' },
    { name: 'ghost-consciousness',script: 'agent/consciousness_bridge.py',interpreter: 'python3',watch: false, autorestart: true, cwd: './', max_memory_restart: '150M', log_file: 'agent/logs/consciousness.log',error_file: 'agent/logs/consciousness-error.log' },
    // Queen orchestrateur (démarre en dernier)
    { name: 'ghost-queen-py',    script: 'agent/queen.py',       interpreter: 'python3', watch: false, autorestart: true, cwd: './', max_memory_restart: '300M', log_file: 'agent/logs/queen_py.log',    error_file: 'agent/logs/queen_py-error.log' },
  ],
};
