# Ghost OS Ultimate — Jarvis opérationnel v1.0.0
*Contexte Claude Code — mis à jour 2026-03-18*

## Vision
Agent autonome hybride 100% local — unification complète de LaRuche v5.0 + PICO-RUCHE.
Node.js Queen + 15 couches Python FastAPI + Conscience universelle + **27 skills**.
Zéro cloud requis, zéro coût token, vie privée totale.

## Architecture

```
Ghost OS Ultimate v1.0.0
├── src/queen_oss.js              :3000  ← Queen Node.js (entrée principale)
│   ├── Butterfly Loop            — plan → parallèle → synthèse
│   ├── Computer Use              — intentPipeline → skills macOS natifs
│   ├── MCP Routes (/mcp/*)       — 9 routes MCP exposées
│   ├── Swarm                     — multi-machine Ollama
│   ├── Market                    — réputation agents
│   └── WebSocket HUD :9001
│
├── agent/                        ← 15 couches Python FastAPI
│   ├── queen.py          :8001   Orchestrateur + HITL + Telegram
│   ├── perception.py     :8002   Screenshots + scan système
│   ├── brain.py          :8003   LLM routing (Claude → Kimi → Ollama)
│   ├── executor.py       :8004   Shell sandboxé + PyAutoGUI
│   ├── evolution.py      :8005   Auto-amélioration skills
│   ├── memory.py         :8006   Épisodes + world state
│   ├── mcp_bridge.py     :8007   Proxy Python → MCP Node.js
│   ├── planner.py        :8008   Planification HTN
│   ├── learner.py        :8009   Skill learning épisodes
│   ├── goals.py          :8010   Autonomous Goal Loop SQLite
│   ├── pipeline.py       :8011   Skill Pipeline Composer
│   ├── miner.py          :8012   Behavior Mining Engine
│   ├── swarm_router.py   :8013   Bee Specialization (5 abeilles)
│   ├── validator.py      :8014   Skill Validator Loop (5 checks + deploy/quarantine)
│   ├── computer_use.py   :8015   Computer Use Master (See→Plan→Act→Verify)
│   ├── consciousness_bridge.py :8016  NeuralEventBus ↔ 15 couches Python
│   └── skill_sync.py     :8019   Sync skills Ruche↔Reine (pull/push auto 5min)
│
├── core/
│   ├── consciousness/    — UniversalConsciousness + NeuralEventBus + EpisodicMemory
│   ├── agents/           — StrategistAgent
│   ├── events/           — EventBus PICO-RUCHE
│   ├── chimera_bus.js    — Mutations auto-évolution
│   └── phagocyte.js      — Patchs YAML/code signés HMAC
│
├── runtime/
│   ├── modes/            — UltimateMode (pleine puissance) + LiteMode (économique)
│   └── deployment/       — AutoDeployment (détecte CPU/RAM/GPU/Ollama)
│
├── ecosystem/marketplace/ — SkillsMarketplace (recherche, install, publish, validate)
├── skills/               — 27 skills JS macOS natifs
├── mcp_servers/          — 12 MCP servers
├── interfaces/dashboard/ — React + Vite :5173
└── interfaces/hud/       — Electron overlay
```

## Commandes de démarrage
```bash
cd /tmp/ghost-skills   # ou chemin du repo

# Setup (détecte l'env, génère la config)
ghost setup   # ou: node bin/ghost.js setup

# Mode ultime (2 terminaux)
python3 start_agent.py                                          # Terminal 1 — 7 couches Python
GHOST_OS_MODE=ultimate STANDALONE_MODE=true node src/queen_oss.js  # Terminal 2

# Via npm
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

# Skills
ghost skill list
ghost skill install <nom>
ghost skill stats

# Dashboard
npm run dash    # http://localhost:5173
npm run hud     # Electron overlay
```

## APIs

### Node.js Queen :3000
| Endpoint | Description |
|----------|-------------|
| `POST /api/mission` | Lancer une mission |
| `GET /api/health` | `{"ok":true}` |
| `GET /api/agents` | État du swarm |
| `GET /api/system` | CPU/RAM/Disque |
| `GET /api/skills` | 27 skills disponibles |
| `GET /api/status` | Status global |
| `POST /mcp/os-control` | Computer Use |
| `POST /mcp/terminal` | Shell sandboxé |
| `POST /mcp/vision` | Analyse écran |
| `POST /mcp/vault` | Mémoire sémantique |
| `POST /mcp/rollback` | Snapshots |
| `POST /mcp/skill-factory` | Génération skills |
| `POST /mcp/janitor` | Maintenance |

> ⚠️ Routes `/api/*` protégées par `Authorization: Bearer <CHIMERA_SECRET>` (sauf `/api/health`, `/mcp/health`)

### Python Queen :8001
| Endpoint | Description |
|----------|-------------|
| `POST /mission` | `{"command": str, "priority": int}` |
| `GET /status` | État 7 couches |
| `GET /hitl/queue` | Actions HITL en attente |
| `GET /health` | `{"status":"ok","vital_loop":bool}` |

## Skills disponibles — 27 (skills/)

### Computer Use — Contrôle macOS natif
| Skill | Description |
|-------|-------------|
| `accessibility_reader` | Lit l'arbre AX macOS, retourne tous les éléments UI sémantiques |
| `find_element` | Trouve un élément UI par description sémantique via l'arbre AX |
| `smart_click` | Clique sur un élément UI par description sémantique |
| `screen_elements` | Analyse sémantique complète de l'écran: app, résolution, éléments groupés |
| `take_screenshot` | Capture d'écran macOS, retourne le chemin |
| `mouse_control` | Contrôle souris via Python Quartz CoreGraphics (déplacer, cliquer, demo cercle) |
| `press_key` | Appuie sur une touche clavier (Return, Space, Tab, Escape…) |
| `press_enter` | Appuie sur Entrée |
| `type_text` | Tape du texte dans le champ actif via AppleScript |
| `wait_for_element` | Attend qu'un élément UI apparaisse (polling AX + timeout) |

### Browser & Navigation
| Skill | Description |
|-------|-------------|
| `open_app` | Ouvre une application macOS (Safari, VSCode, Terminal, Finder…) |
| `goto_url` | Ouvre une URL dans Safari |
| `open_google` | Ouvre google.com dans Safari |

### Système & Fichiers
| Skill | Description |
|-------|-------------|
| `read_file` | Lit un fichier local (max 8000 chars) |
| `run_shell` | Exécute une commande shell de la liste blanche (ls, cat, grep, git…) |
| `run_command` | Exécute une commande shell sûre (ls, cat, git, npm, node, python3, curl) |
| `list_big_files` | Liste les N fichiers les plus lourds (exclude node_modules, .git) |
| `summarize_project` | Résumé structure projet (arbre, package.json, README) |
| `http_fetch` | Appel HTTP GET/POST, retourne le contenu texte |

### Organisation & Automatisation
| Skill | Description |
|-------|-------------|
| `organise_screenshots` | Organise les screenshots par date dans ~/Pictures/Screenshots |
| `organise_telechargements` | Organise ~/Downloads par type de fichier |
| `organise_les_screenshots_par_date_et_les` | Variante PICO-RUCHE: organise screenshots + compression |
| `automatise_l_organisation_des_t_l_charge` | Variante PICO-RUCHE: automatise organisation téléchargements |

### Communication & Intégration
| Skill | Description |
|-------|-------------|
| `telegram_notify` | Envoie un message Telegram (env: BOT_TOKEN + CHAT_ID) |
| `agent_bridge` | Pont ESM → Python: missions vers queen:8001 ou brain:8003 |
| `invoke_claude_code` | Lance Claude Code non-interactif (contourne session imbriquée) |
| `update_world_state` | Met à jour ~/world_state.json — procédure obligatoire fin de mission |

## MCP Servers (mcp_servers/) — 12
| Serveur | Rôle |
|---------|------|
| `browser_mcp.js` | Contrôle navigateur Playwright |
| `playwright_mcp.js` | Automation web avancée |
| `os_control_mcp.js` | Contrôle OS macOS (AppleScript, pyautogui) |
| `terminal_mcp.js` | Exécution terminal (sandboxé) |
| `vision_mcp.js` | Analyse vision (llava, moondream) |
| `vault_mcp.js` | Stockage secrets sécurisé |
| `skill_factory_mcp.js` | Création de nouveaux skills à la volée |
| `janitor_mcp.js` | Nettoyage, maintenance |
| `rollback_mcp.js` | Rollback d'actions |
| `pencil_mcp.js` | Intégration Pencil (.pen design files) |
| `mcp-compressor/` | Compression contexte (économie tokens) |
| `mcp-context-manager/` | Gestion contexte long |

## Variables .env requises
```bash
STANDALONE_MODE=true
OLLAMA_HOST=http://localhost:11434
TELEGRAM_BOT_TOKEN=          # @BotFather
ADMIN_TELEGRAM_ID=           # @userinfobot
ANTHROPIC_API_KEY=           # optionnel — brain layer
GHOST_OS_MODE=ultimate       # ultimate | lite | cloud
HITL_TIMEOUT_SECONDS=120
CHIMERA_SECRET=              # HMAC pour Chimera Bus (protège /api/*)
```

## Telegram HITL
- `/status` → état de l'essaim
- `/mission <texte>` → lancer une mission
- `ok-XXXX` / `non-XXXX` → validation HITL avec countdown 120s

## Composants core/consciousness/
| Composant | Rôle |
|-----------|------|
| `UniversalConsciousness` | Boucle conscience 30s, 5 états, heartbeat NeuralEventBus |
| `NeuralEventBus` | Bus événements haute perf, priorités, middleware, métriques |
| `EpisodicMemorySystem` | Mémoire épisodique, cosine-similarity bag-of-words |
| `StrategistAgent` | Planification stratégique via Brain :8003 |

## Sécurité
- Shell patterns bloqués : `rm -rf /`, fork bomb, `dd if=/dev/zero`, `mkfs`, `shutdown`
- HITL obligatoire pour risque HIGH
- pyautogui FAILSAFE actif (coin haut-gauche = arrêt d'urgence)
- Chimera Bus signé HMAC-SHA256
- Sandbox timeout max 30s, output tronqué 10k chars
- Routes `/api/*` protégées Bearer token (sauf `/health`, `/mcp/health`)

## Ajouter un skill
```bash
mkdir skills/mon_skill
# Créer skill.js (export async function run(params)) + manifest.json
# Ajouter dans skills/registry.json
# Ou: ghost skill install <chemin_local>
```

## Optimisations Ollama
- `keep_alive: -1` → modèles restent en RAM
- `top_k: 20` → 50% moins de calcul
- `f16_kv: true` → 2x moins de RAM
- Fast path < 80 chars → 1 appel LLM (≈1.3s)
- `num_predict: 700` → stoppe la sur-génération

## Stack technique
- **Node.js** 20+ ESM, Hono + WebSocket :9001, Telegraf, PM2
- **Python** 3.11+, FastAPI, pyautogui, httpx, SQLite
- **LLM** Ollama local (llama3, moondream) + Claude API fallback + Kimi
- **Bee Specialization** :8013 — UIAgent · FileAgent · CodeAgent · WebAgent · SystemAgent
- **Consciousness Bridge** :8016 — NeuralEventBus Node.js ↔ 15 couches Python · tail-follow signals.jsonl
- **Frontend** React 18 + Vite + Tailwind (dashboard :5173), Electron (HUD)
- **Tests** Jest 29 (ESM) + Pytest
