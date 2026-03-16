# 👻 Ghost OS Ultimate

**Open Source Autonomous AI Agent Platform** — macOS · Python · Node.js

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/template/ghost-os)

> 16 Python layers + Node.js Queen + Claude Vision Computer Use + Auto-evolution

---

## Quick Start (30 seconds)

```bash
git clone https://github.com/AMFbot-Gz/ghost-os-ultimate
cd ghost-os-ultimate
cp .env.example .env        # Add ANTHROPIC_API_KEY + TELEGRAM_BOT_TOKEN

# One-click setup: LaunchAgent + PM2 + Cron + preflight
bash scripts/setup_7day_autonomy.sh

# Send a mission
curl -X POST http://localhost:3000/api/mission \
  -H "Content-Type: application/json" \
  -d '{"command": "Organize my Desktop folder"}'
```

## Architecture

```
Ghost OS Ultimate
├── Queen Node.js :3000     ← REST API + 29 skills + Telegram + WebSocket HUD
├── Python Layers
│   ├── :8001 Queen.py      ← Vital loop + HITL
│   ├── :8003 Brain.py      ← ReAct + ToT + Claude/Kimi/Ollama fallback
│   ├── :8004 Executor.py   ← Shell sandbox + PyAutoGUI
│   ├── :8005 Evolution.py  ← Auto-generates skills via Claude
│   ├── :8006 Memory.py     ← ChromaDB semantic memory
│   ├── :8014 Validator.py  ← Confidence scoring (gold/silver/bronze)
│   └── :8015 ComputerUse  ← Claude Vision GUI automation (Retina-aware)
└── Autonomous Weekly Cycle
    ├── dream_cycle (1h)     → extract heuristics from episodes
    ├── architect_cycle (Sun 3am) → fill skill gaps, update docs, git tag
    └── self_healing (10s)   → circuit breaker per layer, auto-restart
```

## Features

| Feature | Status |
|---------|--------|
| Computer Use (Claude Vision) | ✅ Zero-config, Retina-aware |
| ReAct + Tree of Thoughts | ✅ Multi-step reasoning |
| Self-healing layers | ✅ Circuit breaker + exponential backoff |
| Auto-skill generation | ✅ Claude generates Node.js skills |
| Semantic memory | ✅ ChromaDB + heuristics |
| HITL via Telegram | ✅ Approval + 120s countdown |
| Weekly autonomous cycle | ✅ Audit → gaps → generate → tag |
| Docker production | ✅ `infra/docker/` |
| Railway deploy | ✅ `railway.toml` |
| SaaS auth (API keys) | ✅ `src/saas/` |

## Deploy

### Local (recommended)
```bash
bash scripts/setup_7day_autonomy.sh
```

### Docker
```bash
cp .env.example .env
docker-compose -f infra/docker/docker-compose.prod.yml up -d
```

### Railway (cloud API, no Computer Use)
[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/template/ghost-os)

### Vercel (dashboard only)
[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/AMFbot-Gz/ghost-os-ultimate&root=interfaces/dashboard)

## Environment Variables

```bash
# Required
ANTHROPIC_API_KEY=sk-ant-...      # Claude API
TELEGRAM_BOT_TOKEN=...            # @BotFather
ADMIN_TELEGRAM_ID=...             # @userinfobot

# Optional
OLLAMA_HOST=http://localhost:11434
GHOST_OS_MODE=ultimate            # ultimate | lite | cloud
CHIMERA_SECRET=...                # API auth secret
```

## API

```bash
# Mission
POST /api/mission    {"command": "your task"}

# Status
GET  /api/health
GET  /api/agents
GET  /api/skills

# Computer Use
POST /api/v1/cu/session   {"goal": "...", "max_steps": 10}
GET  /api/v1/cu/session/:id

# API Keys (SaaS)
POST /api/v1/keys
GET  /api/v1/usage
```

## Tests

```bash
npm test                  # 289 Jest tests
npm run test:python       # 990 Pytest tests
python3 scripts/architect_weekly_cycle.py --dry-run  # Full audit
```

## Roadmap

- [x] Computer Use Vision (zero-config)
- [x] Self-healing daemon (circuit breaker)
- [x] Weekly autonomous architect cycle
- [x] SaaS auth layer (API keys)
- [x] Railway + Docker + Vercel deploy configs
- [ ] Cloud-hosted version (no local GPU needed)
- [ ] Multi-tenant isolation
- [ ] Stripe billing integration
- [ ] Public skill marketplace

## Sister Repos (Historical)

- **[PICO-RUCHE](https://github.com/AMFbot-Gz/PICO-RUCHE)** — Ghost OS v5.0 (archived, predecessor)
- **[LaRuche](https://github.com/AMFbot-Gz/LaRuche)** — Chimera OS prototype (archived)
- **[AMFbot-Suite](https://github.com/AMFbot-Gz/AMFbot-Suite)** — Legacy JARVIS v2.6 (archived)

## License

MIT — Free to use, modify, deploy.
