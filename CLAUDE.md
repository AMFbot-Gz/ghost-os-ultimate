# Ghost OS Ultimate — Guide ingénieur

## Vision
Agent autonome hybride 100% local — unification complète de LaRuche v5.0 + PICO-RUCHE.
Node.js Queen + 9 couches Python FastAPI + Conscience universelle + 38+ skills.

## Architecture

```
Ghost OS Ultimate v1.0.0
├── src/queen_oss.js              :3000  ← Queen Node.js (entrée principale)
│   ├── Butterfly Loop
│   ├── Computer Use (intentPipeline → skills)
│   ├── MCP Routes (/mcp/*)
│   ├── Swarm (multi-machine Ollama)
│   ├── Market (réputation agents)
│   └── WebSocket HUD :9001
│
├── agent/                               ← 11 couches Python FastAPI
│   ├── queen.py          :8001  Orchestrateur + HITL + Telegram (Phase 12)
│   ├── perception.py     :8002  Screenshots + scan système
│   ├── brain.py          :8003  LLM routing (Claude → Kimi → Ollama)
│   ├── executor.py       :8004  Shell sandboxé + PyAutoGUI
│   ├── evolution.py      :8005  Auto-amélioration skills
│   ├── memory.py         :8006  Épisodes + world state
│   ├── mcp_bridge.py     :8007  Proxy Python → MCP Node.js
│   ├── planner.py        :8008  Planification HTN (Phase 10)
│   ├── learner.py        :8009  Skill learning épisodes (Phase 11)
│   ├── goals.py          :8010  Autonomous Goal Loop SQLite (Phase 13)
│   └── pipeline.py       :8011  Skill Pipeline Composer (Phase 14)
│
├── core/
│   ├── consciousness/            ← NOUVEAU — conscience universelle
│   │   ├── universal_consciousness.js
│   │   ├── neural_event_bus.js
│   │   └── episodic_memory_system.js
│   ├── agents/                   ← NOUVEAU — agents spécialisés
│   │   └── strategist_agent.js
│   ├── events/event_bus.js       ← Bus événements PICO-RUCHE
│   ├── chimera_bus.js            ← Mutations auto-évolution
│   └── phagocyte.js              ← Patchs YAML/code signés HMAC
│
├── runtime/
│   ├── modes/
│   │   ├── ultimate_mode.js      ← NOUVEAU — pleine puissance
│   │   └── lite_mode.js          ← NOUVEAU — ressources limitées
│   └── deployment/
│       └── auto_deployment.js    ← NOUVEAU — config adaptative
│
├── ecosystem/
│   └── marketplace/
│       └── skills_marketplace.js ← NOUVEAU — gestion skills
│
├── skills/                       ← 38 skills (25 PICO + 13 LaRuche)
├── mcp_servers/                  ← 9 MCP servers
├── interfaces/
│   ├── dashboard/                ← Dashboard React/Vite
│   └── hud/                      ← Electron overlay
└── config/
    └── default/ghost_os_ultimate.yml ← NOUVEAU — config centrale
```

## Commandes essentielles

```bash
# Setup initial (détecte l'environnement, génère la config)
ghost setup
# ou: node bin/ghost.js setup

# Lancer en mode ultime (2 terminaux)
python3 start_agent.py                                    # Terminal 1 — 7 couches Python
GHOST_OS_MODE=ultimate STANDALONE_MODE=true node src/queen_oss.js  # Terminal 2

# Ou via npm
npm run ultimate       # Mode ultime
npm run lite           # Mode léger
npm run dev            # Dev standalone

# État
ghost status
python3 scripts/status_agent.py

# Mission
ghost mission "Analyse le dossier Desktop et résume-le"
curl -X POST http://localhost:8001/mission \
  -H "Content-Type: application/json" \
  -d '{"command": "ta mission", "priority": 3}'

# Tests
npm test                   # 243+ tests Jest
npm run test:python        # 287+ tests Pytest
npm run test:all

# Skills marketplace
ghost skill list
ghost skill install <nom>
ghost skill stats

# Dashboard
npm run dash               # http://localhost:5173

# HUD Electron
npm run hud
```

## Nouveaux composants (v1.0.0)

### core/consciousness/
- **UniversalConsciousness** — Boucle de conscience (30s), 5 états, heartbeat sur NeuralEventBus
- **NeuralEventBus** — Bus événements haute perf, priorités, middleware, métriques
- **EpisodicMemorySystem** — Mémoire épisodique avec recherche cosine-similarity (bag-of-words)

### core/agents/
- **StrategistAgent** — Planification stratégique via Brain layer (port 8003)

### runtime/modes/
- **UltimateMode** — Active toutes les couches + conscience + swarm
- **LiteMode** — Mode économique, 1 mission parallèle max

### runtime/deployment/
- **AutoDeployment** — Détecte CPU/RAM/GPU/Ollama et recommande la config optimale

### ecosystem/marketplace/
- **SkillsMarketplace** — Recherche, installation, publication, validation de skills

### bin/
- **ghost** — CLI unifié (start, status, mission, setup, skill)

## APIs

### Node.js Queen :3000
```
POST /api/mission          → lancer une mission
GET  /api/health           → {"ok":true}
GET  /api/agents           → état swarm
GET  /api/system           → CPU/RAM/Disque
GET  /api/skills           → 38 skills
GET  /api/status           → status global
POST /mcp/os-control       → computer-use
POST /mcp/terminal         → shell sandboxé
POST /mcp/vision           → analyse écran
POST /mcp/vault            → mémoire sémantique
POST /mcp/rollback         → snapshots
POST /mcp/skill-factory    → génération skills
POST /mcp/janitor          → maintenance
GET  /mcp/health           → état 7 routes MCP
```

### Python Queen :8001
```
POST /mission              → {"command": str, "priority": int}
GET  /status               → état 7 couches
GET  /hitl/queue           → actions HITL en attente
GET  /health               → {"status":"ok","vital_loop":bool}
```

## Telegram HITL
- `/status` → état de l'essaim
- `/mission <texte>` → lancer une mission
- `ok-XXXX` / `non-XXXX` → HITL avec countdown 120s

## Variables .env requises
```bash
STANDALONE_MODE=true
OLLAMA_HOST=http://localhost:11434
TELEGRAM_BOT_TOKEN=          # @BotFather
ADMIN_TELEGRAM_ID=           # @userinfobot
ANTHROPIC_API_KEY=           # optionnel — brain layer
GHOST_OS_MODE=ultimate       # ultimate | lite | cloud
HITL_TIMEOUT_SECONDS=120
CHIMERA_SECRET=              # HMAC pour Chimera Bus
```

## Ajouter un skill Node.js
```bash
mkdir skills/mon_skill
# Créer skill.js (export async function run(params)) + manifest.json
# Ajouter dans skills/registry.json
# Ou: ghost skill install <chemin_local>
```

## Sécurité
- Shell patterns bloqués : rm -rf /, fork bomb, dd if=/dev/zero, mkfs, shutdown, reboot
- HITL obligatoire pour risque HIGH
- pyautogui FAILSAFE actif (coin haut-gauche = arrêt)
- Chimera Bus signé HMAC-SHA256
- Sandbox timeout max 30s, output tronqué à 10k chars
- **Routes /api/* protégées par Bearer token** : toutes les requêtes vers `/api/*` nécessitent le header `Authorization: Bearer <CHIMERA_SECRET>` (sauf `/api/health`, `/health`, `/mcp/health` qui restent publiques). En mode dev (CHIMERA_SECRET absent ou valeur par défaut), le middleware laisse passer avec un warning.

## Stack
- **Node.js** 20+ (ESM), Hono + WebSocket, Telegraf, PM2
- **Python** 3.11+, FastAPI, pyautogui, httpx, SQLite
- **LLM** Ollama local (llama3, moondream) + Claude API fallback
- **Frontend** React 18 + Vite + Tailwind (dashboard), Electron (HUD)
- **Tests** Jest 29 (ESM) + Pytest
