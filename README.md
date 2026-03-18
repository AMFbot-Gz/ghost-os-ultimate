# Jarvis v2.0 — Agent IA autonome 100% local

```bash
curl -fsSL https://raw.githubusercontent.com/wiaamhadara/ghost-os-ultimate/main/install.sh | bash
```

**Agent personnel souverain.** Zero cloud. Zero abonnement. Votre Mac parle français et exécute 40+ skills.

---

## Comparatif

| Fonctionnalité | Jarvis v2.0 | OpenJarvis | ChatGPT |
|---|---|---|---|
| 100% local | ✅ | ✅ | ❌ Cloud uniquement |
| Contrôle macOS natif | ✅ | ⚠️ partiel | ❌ |
| Telegram bot perso | ✅ | ❌ | ❌ |
| 40+ skills intégrés | ✅ | ~15 | plugins payants |
| Agent satellite léger | ✅ PicoClaw | ❌ | ❌ |
| Multi-turn + mémoire | ✅ | ⚠️ | ✅ (cloud) |
| Auto-repair PM2 | ✅ | ❌ | ❌ |
| Prix | Gratuit | Gratuit | $20/mois |

---

## Installation

### Prérequis

- macOS 12+ (ARM64 ou Intel) / Ubuntu 20+ / Debian 11+
- Node.js 18+
- Python 3.11+ *(recommandé pour les agents Python)*
- Ollama (pour LLM local) : [ollama.ai](https://ollama.ai)
- Un bot Telegram : créez-le via [@BotFather](https://t.me/BotFather)

### Installation en une commande

```bash
curl -fsSL https://raw.githubusercontent.com/wiaamhadara/ghost-os-ultimate/main/install.sh | bash
```

### Installation locale (depuis ce dépôt)

```bash
git clone https://github.com/wiaamhadara/ghost-os-ultimate.git
cd ghost-os-ultimate
bash install.sh
```

### Configuration

```bash
jarvis setup          # Wizard interactif (token Telegram, Ollama, API keys)
jarvis start          # Démarre les 15 processus PM2
jarvis status         # Vérifie tout
```

---

## Architecture

```
Telegram ──→ jarvis-gateway (Telegraf)
                │
                ├──→ orchestrator.js ──→ skills/ (40+ skills JS)
                │         │
                │         └──→ queen-node :3002 ──→ agents Python :8001-:8019
                │
                ├──→ world-model.js   ─── contexte PM2 + disk + Ollama (5min)
                ├──→ proactive_watcher ── 5 règles (disk, PM2, emails, briefing)
                └──→ pico-satellite   ─── PicoClaw Go :8090 (tâches légères)

PM2 Processus (15) :
  1. jarvis-gateway    Bot Telegram unique
  2. queen-node        API REST :3002
  3. agents-python     16 agents FastAPI :8001-:8019
  4. ollama-watchdog   Surveillance Ollama
  5. ruche-bridge      Bridge ruche-corps :8020
  6. pico-compressor   MCP compression contexte
  7. moltbot-bridge    Multi-canaux :3003
  8. vital-loop        Health 24/7
  9. goals-scheduler   Goals autonomes :3005
 10. memory-hub        Mémoire JSONL :3004
 11. self-repair       Auto-patch PM2 bus
 12. night-worker      Tâches nocturnes 02h-08h
 13. stitch-bridge     Workflows vente :3006
 14. laruche-sync      Sync LaRuche :3007
 15. pico-satellite    Agent Go léger :8090
```

---

## Exemples Telegram

```
Toi → Jarvis
─────────────────────────────────────────────────────────────────
"prends un screenshot"          → screenshot Retina → photo Telegram
"état du système"               → CPU, RAM, disque, Ollama, PM2
"trie mes emails"               → skill email-triage → résumé
"rapport ventes du jour"        → skill e-commerce → tableau ventes
"ouvre Chrome et va sur Gmail"  → mac-control → screenshot confirmation
"commit et push"                → git add -A && git commit && git push
"cherche comment faire X"       → PicoClaw WebSearch → réponse
"rappelle-moi demain à 9h de Y" → goals-scheduler → notification
```

---

## CLI jarvis

```bash
jarvis start          # Démarre Jarvis (15 processus PM2)
jarvis stop           # Arrête tout
jarvis restart        # Redémarre tout
jarvis status         # État PM2 + satellite + queen + Ollama
jarvis update         # git pull + npm install + restart
jarvis logs [nom]     # Logs en temps réel (défaut: jarvis-gateway)
jarvis skills         # Liste les 40+ skills
jarvis setup          # Wizard de configuration .env
jarvis uninstall      # Supprime le symlink
```

---

## Skills disponibles (40+)

| Catégorie | Skills |
|---|---|
| **Computer Use** | take_screenshot, smart_click, type_text, find_element, screen_elements, mouse_control, press_key, accessibility_reader, wait_for_element |
| **Browser** | open_app, goto_url, open_google |
| **Système** | read_file, run_shell, run_command, list_big_files, summarize_project, http_fetch, system_info, clipboard |
| **Organisation** | organise_screenshots, organise_telechargements |
| **Communication** | telegram_notify |
| **Intégration** | agent_bridge, invoke_claude_code, update_world_state |
| **DevOps** | docker_control, ollama_control, tailscale_control |
| **Satellite** | cli_anything_bridge |

### Créer un skill

```bash
mkdir skills/mon_skill
# skill.js : export async function run(params) { ... }
# manifest.json : { "name", "description", "triggers": [...] }
# → Rechargement automatique au prochain démarrage
```

---

## Variables .env

```bash
# Obligatoires
TELEGRAM_BOT_TOKEN=123456789:ABCdef...    # @BotFather
ADMIN_TELEGRAM_ID=123456789               # @userinfobot
CHIMERA_SECRET=votre_secret_hmac

# Recommandées
OLLAMA_HOST=http://localhost:11434
OLLAMA_MODEL=llama3.2:3b
GHOST_OS_MODE=ultimate

# Optionnelles
ANTHROPIC_API_KEY=sk-ant-...              # Fallback cloud
PICOCLAW_PORT=8090                        # Satellite Go
```

---

## PicoClaw Satellite

Agent Go léger qui traite les requêtes simples sans charger Ollama principal :

```bash
# Installation automatique via install.sh
# Ou manuellement :
curl -fsSL https://github.com/sipeed/picoclaw/releases/download/v0.2.3/picoclaw_Darwin_arm64.tar.gz \
  | tar -xz -C satellite/

# Test
curl http://localhost:8090/health
```

---

## Développement

```bash
# Mode dev (watch + logs verbose)
NODE_ENV=development pm2 start ecosystem.config.cjs --env development

# Tests
npm test

# Linter
npm run lint

# Ajouter un modèle Ollama
ollama pull llama3.2:3b
ollama pull moondream      # vision
```

---

## Licence

MIT — Wiaam Hadara, 2026
