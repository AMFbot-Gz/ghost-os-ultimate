# Ghost OS Ultimate

**Agent autonome hybride 100% local — computer use, mémoire épisodique, skills extensibles.**

Ghost OS Ultimate tourne entièrement sur ta machine. Aucune donnée envoyée dans le cloud. Tu gardes le contrôle depuis Telegram avec un HITL (Human-in-the-Loop) à 120 secondes.

```
┌─────────────────────────────────────────────────────────┐
│                   Ghost OS Ultimate                     │
│                                                         │
│  Telegram / REST / CLI  ──►  Queen Node.js :3000        │
│                               │                         │
│                    ┌──────────┼──────────┐              │
│                    ▼          ▼          ▼              │
│             Brain :8003  Memory :8006  Exec :8004       │
│             Perception  Evolution   MCP Bridge          │
│                    :8002      :8005      :8007           │
│                    └──────────┼──────────┘              │
│                               ▼                         │
│              38 Skills · 9 MCP Servers · HUD Electron   │
└─────────────────────────────────────────────────────────┘
```

## Prérequis

| Outil | Version |
|---|---|
| Node.js | ≥ 20 |
| Python | ≥ 3.11 |
| Ollama | latest |
| macOS | ≥ 13 (Ventura) |

```bash
# Modèles Ollama requis
ollama pull llama3
ollama pull llama3.2:3b
ollama pull moondream
```

## Installation

```bash
git clone https://github.com/AMFbot-Gz/ghost-os-ultimate
cd ghost-os-ultimate

# Dépendances Node.js
npm install

# Dépendances Python (runtime minimal — <2 min)
pip3 install -r requirements-runtime.txt

# Configuration
cp .env.example .env
# Éditer .env : TELEGRAM_BOT_TOKEN, ADMIN_TELEGRAM_ID, CHIMERA_SECRET
```

## Démarrage rapide (5 commandes)

```bash
# 1. Vérifier l'environnement
node bin/ghost.js setup

# 2. Terminal 1 — 7 couches Python
python3 start_agent.py

# 3. Terminal 2 — Queen Node.js
npm run ultimate

# 4. Vérifier l'état
node bin/ghost.js status

# 5. Lancer une première mission
node bin/ghost.js mission "Prends un screenshot et décris ce que tu vois"
```

## Dashboard

```bash
cd interfaces/dashboard && npm install && npm run dev
# → http://localhost:5173
```

## Architecture

```
ghost-os-ultimate/
├── src/               Queen Node.js :3000 — orchestrateur principal
├── agent/             7 couches Python FastAPI :8001-8007
├── core/
│   ├── consciousness/ UniversalConsciousness + NeuralEventBus + EpisodicMemory
│   ├── agents/        StrategistAgent
│   ├── chimera_bus.js Mutations signées HMAC-SHA256
│   └── phagocyte.js   Auto-patchs YAML/code vérifiés
├── skills/            38 skills Node.js (computer use, system, web...)
├── mcp_servers/       9 MCP servers
├── runtime/
│   ├── modes/         UltimateMode · LiteMode
│   └── deployment/    AutoDeployment + Dockerfile
├── ecosystem/
│   └── marketplace/   SkillsMarketplace
├── interfaces/
│   ├── dashboard/     React + Vite
│   └── hud/           Electron overlay
└── config/
    └── default/       ghost_os_ultimate.yml
```

## Telegram HITL

Une fois le bot configuré :

| Commande | Effet |
|---|---|
| `/status` | État des 8 couches |
| `/mission <texte>` | Lancer une mission |
| `ok-XXXX` | Approuver une action risquée |
| `non-XXXX` | Annuler (timeout auto 120s) |

## Skills marketplace

```bash
# Lister les skills installés
node bin/ghost.js skill list

# Stats
node bin/ghost.js skill stats
```

## Tests

```bash
npm test                  # 243+ tests Jest
npm run test:python       # 287+ tests Pytest
npm run test:all          # Suite complète
```

## Variables .env

```bash
# Obligatoires
TELEGRAM_BOT_TOKEN=       # depuis @BotFather
ADMIN_TELEGRAM_ID=        # depuis @userinfobot
CHIMERA_SECRET=           # chaîne aléatoire longue (openssl rand -hex 32)

# Ollama
STANDALONE_MODE=true
OLLAMA_HOST=http://localhost:11434

# Optionnels
ANTHROPIC_API_KEY=        # fallback cloud pour Brain layer
GHOST_OS_MODE=ultimate    # ultimate | lite
HITL_TIMEOUT_SECONDS=120
```

## Docker

```bash
docker-compose up -d
# Queen Node.js  → http://localhost:3000
# Python Queen   → http://localhost:8001
```

## Modes d'exécution

| Mode | RAM | Missions parallèles | Conscience |
|---|---|---|---|
| `ultimate` | illimitée | 5 | ✅ |
| `lite` | 500 MB | 1 | ❌ |

```bash
npm run ultimate   # Mode ultime
npm run lite       # Mode léger (machines < 8 GB)
```

## Sécurité

- Shell sandboxé — patterns bloqués : `rm -rf /`, fork bomb, `dd if=/dev/zero`, `mkfs`, `shutdown`
- HITL obligatoire pour risque HIGH
- Chimera Bus signé HMAC-SHA256
- Timeout sandbox max 30s
- pyautogui FAILSAFE (coin haut-gauche = arrêt d'urgence)

## Contribuer

Voir [CONTRIBUTING.md](CONTRIBUTING.md).

## Licence

MIT — voir [LICENSE](LICENSE).
