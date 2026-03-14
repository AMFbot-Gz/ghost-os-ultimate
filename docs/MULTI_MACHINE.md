# Ghost OS Ultimate — Architecture Multi-Machine

## Vue d'ensemble

Ghost OS Ultimate peut contrôler plusieurs ordinateurs (Mac, Linux, Windows) depuis
un seul cerveau centralisé. L'architecture repose sur deux composants :

```
┌──────────────────────────────────────────────────────────────────┐
│                    GHOST CORE  (machine cerveau)                   │
│                                                                    │
│  POST /api/mission { command, machine_id }                         │
│  GET  /api/machines                                                │
│  GET  /api/machines/:id/health                                     │
│  GET  /api/machines/:id/missions                                   │
│                      ↓                                             │
│         ComputerUseAdapter (interface abstraite)                   │
│           ├── MacOsDirectAdapter  (machine locale)                 │
│           └── DaemonClientAdapter (machines distantes)             │
└──────────────────────────┬───────────────────────────────────────┘
                           │ HTTP JSON
          ┌────────────────┼───────────────────┐
          ↓                ↓                   ↓
  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
  │ Ghost Daemon  │  │ Ghost Daemon  │  │ Ghost Daemon  │
  │  mac-local    │  │  mac-bureau   │  │  linux-srv   │
  │  :9000        │  │  :9000        │  │  :9000        │
  │               │  │               │  │               │
  │ AX macOS      │  │ AX macOS      │  │ AT-SPI/xdo   │
  └──────────────┘  └──────────────┘  └──────────────┘
```

## Composants

### Ghost Core (`src/queen_oss.js`)
Le cerveau. Reçoit les missions, planifie, appelle les daemons via `ComputerUseAdapter`.
Tourne sur une seule machine (ex: Mac M2 principal).

### Ghost Daemon (`daemon/ghost_daemon.js`)
Petit serveur HTTP à déployer sur chaque machine à contrôler.
Expose 5 routes standard et délègue aux APIs natives de l'OS.

### ComputerUseAdapter (`src/computer_use/adapter.js`)
Interface abstraite. Sélectionne automatiquement l'implémentation :
- `MacOsDirectAdapter` → machine locale (wraps les skills existants)
- `DaemonClientAdapter` → machine distante (appels HTTP vers daemon)

### Machine Registry (`src/computer_use/machine_registry.js`)
Stocke les profils machines dans `data/machine_profiles/<machineId>.json` :
résolution, apps fréquentes, métriques de performance, patterns appris.

---

## Installation sur 2-3 machines

### Scénario : Mac cerveau + Mac bureau + serveur Linux

#### Machine 1 — Mac cerveau (Ghost Core complet)

```bash
# Cloner le projet
git clone https://github.com/AMFbot-Gz/ghost-os-ultimate
cd ghost-os-ultimate

# Configurer
cp .env.example .env
# Éditer .env :
#   MACHINE_ID=mac-local
#   DAEMON_PORT=9000
#   DAEMON_IMPL=macos

# Installer les dépendances
make install

# Lancer le Core + le daemon local
make start          # Terminal 1 — 7 couches Python
make core-only      # Terminal 2 — Queen Node.js
make daemon         # Terminal 3 — daemon macOS local (port 9000)
```

Vérification :
```bash
curl http://localhost:3000/api/health       # {"ok":true}
curl http://localhost:9000/health           # {"machine_id":"mac-local","platform":"darwin",...}
```

---

#### Machine 2 — Mac bureau (Ghost Daemon seulement)

```bash
# Installer Node.js 20+
brew install node

# Copier uniquement le daemon
mkdir ghost-daemon && cd ghost-daemon
# Copier daemon/ghost_daemon.js et daemon/package.json

# Configurer
cat > .env << 'EOF'
MACHINE_ID=mac-bureau
DAEMON_PORT=9000
DAEMON_IMPL=macos
GHOST_CORE_URL=http://192.168.1.100:3000   # IP du Mac cerveau
PYTHON_PERCEPTION_URL=http://127.0.0.1:8002
PYTHON_EXECUTOR_URL=http://127.0.0.1:8004
EOF

# Lancer les couches Python (perception + executor au minimum)
python3 start_agent.py --layers perception,executor

# Lancer le daemon
node ghost_daemon.js
```

Vérification :
```bash
curl http://mac-bureau.local:9000/health
# {"machine_id":"mac-bureau","platform":"darwin","impl":"macos",...}
```

---

#### Machine 3 — Serveur Linux (Ghost Daemon Linux)

```bash
# Installer Node.js + xdotool + scrot
apt install nodejs xdotool scrot -y

# Copier ghost_daemon.js + package.json
cat > .env << 'EOF'
MACHINE_ID=linux-srv
DAEMON_PORT=9000
DAEMON_IMPL=linux
GHOST_CORE_URL=http://192.168.1.100:3000
EOF

node ghost_daemon.js
```

---

#### Déclarer les machines au Core

Option A — Automatique : le daemon s'enregistre au démarrage si `GHOST_CORE_URL` est défini.

Option B — Manuel via API :
```bash
curl -X POST http://localhost:3000/api/machines/register \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $CHIMERA_SECRET" \
  -d '{
    "machine_id": "mac-bureau",
    "platform": "darwin",
    "daemon_url": "http://192.168.1.101:9000",
    "label": "Mac Bureau M2 Pro"
  }'
```

---

## Envoyer une mission à une machine spécifique

```bash
# Mission sur la machine locale (défaut)
curl -X POST http://localhost:3000/api/mission \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $CHIMERA_SECRET" \
  -d '{"command": "ouvre Safari et va sur https://google.com"}'

# Mission sur le Mac bureau
curl -X POST http://localhost:3000/api/mission \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $CHIMERA_SECRET" \
  -d '{
    "command": "tape Bonjour dans le chat Teams",
    "machine_id": "mac-bureau"
  }'

# Mission sur le serveur Linux
curl -X POST http://localhost:3000/api/mission \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $CHIMERA_SECRET" \
  -d '{
    "command": "prends un screenshot et analyse-le",
    "machine_id": "linux-srv"
  }'
```

---

## Vérifier l'état de toutes les machines

```bash
# Liste toutes les machines connues
curl http://localhost:3000/api/machines \
  -H "Authorization: Bearer $CHIMERA_SECRET"

# Health d'une machine spécifique
curl http://localhost:3000/api/machines/mac-bureau/health \
  -H "Authorization: Bearer $CHIMERA_SECRET"

# Missions d'une machine
curl http://localhost:3000/api/machines/mac-bureau/missions \
  -H "Authorization: Bearer $CHIMERA_SECRET"

# Makefile
make machines
```

---

## Docker (daemon sur machine contrôlée)

```bash
# Build
docker build -t ghost-daemon -f daemon/Dockerfile .

# Run (mode stub pour test)
docker run -p 9000:9000 \
  -e MACHINE_ID=docker-test \
  -e DAEMON_IMPL=stub \
  ghost-daemon

# Run (mode macOS — nécessite accès aux APIs système)
docker run --privileged -p 9000:9000 \
  -e MACHINE_ID=mac-docker \
  -e DAEMON_IMPL=macos \
  -e PYTHON_PERCEPTION_URL=http://host.docker.internal:8002 \
  -e PYTHON_EXECUTOR_URL=http://host.docker.internal:8004 \
  ghost-daemon
```

---

## Profils machines

Les profils sont stockés dans `data/machine_profiles/<machineId>.json` :

```json
{
  "machine_id": "mac-bureau",
  "label": "Mac Bureau M2 Pro",
  "platform": "darwin",
  "daemon_url": "http://192.168.1.101:9000",
  "resolution": { "width": 2560, "height": 1600 },
  "theme": "dark",
  "frequent_apps": ["Safari", "Slack", "VSCode"],
  "perf": {
    "click_success_rate": 0.97,
    "avg_action_ms": 245,
    "total_actions": 1423,
    "total_errors": 43
  },
  "patterns": {
    "ouvre slack": [
      { "skill": "open_app", "params": { "app": "Slack" } }
    ]
  },
  "last_seen": "2026-03-14T03:30:00Z"
}
```

---

## Sécurité réseau

- **LAN/VPN uniquement** : ne jamais exposer le daemon sur Internet.
- **Secret partagé** : `DAEMON_SECRET` → envoyé dans `X-Ghost-Secret`.
- **HTTPS** : utiliser un reverse proxy (nginx + cert autosigné) si LAN non sécurisé.
- **Firewall** : n'ouvrir que les ports 3000 (Core) et 9000 (Daemon) en interne.

---

## TODO / Extensions futures

- [ ] **Windows daemon** : implémenter `windows.observe()` avec UIAutomation Python
- [ ] **Linux daemon** : implémenter `linux.observe()` avec AT-SPI2 / atspi
- [ ] **WebSocket live** : remplacer polling `/wait` par un canal WS push
- [ ] **mTLS** : auth mutuelle entre Core et Daemons (PKI interne)
- [ ] **LARUCHE_HOME** : variable env pour isoler `~/.laruche/` par projet
- [ ] **Dashboard machines** : onglet dédié dans le dashboard React
- [ ] **Auto-découverte LAN** : daemon annonce sa présence via mDNS/Zeroconf
