# Ghost OS Ultimate — Dockerfile multi-stage
# Stage 1 : dépendances Python (minimal runtime — sans torch, sans Whisper)
# Stage 2 : application Node.js + Python

# ─── Base Python ──────────────────────────────────────────────────────────────
FROM python:3.11-slim AS python-deps

WORKDIR /app

# Dépendances système minimales
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copier uniquement le requirements runtime (sans torch/whisper/vosk)
COPY requirements-runtime.txt .
RUN pip install --no-cache-dir -r requirements-runtime.txt

# ─── Base Node.js ─────────────────────────────────────────────────────────────
FROM node:20-slim AS node-deps

WORKDIR /app

# Copier package.json sans scripts postinstall lourds
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ─── Image finale ─────────────────────────────────────────────────────────────
FROM node:20-slim

# Installer Python 3.11
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.11 \
    python3-pip \
    python3.11-venv \
    curl \
    && ln -sf /usr/bin/python3.11 /usr/bin/python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copier les dépendances pré-installées
COPY --from=python-deps /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=python-deps /usr/local/bin /usr/local/bin
COPY --from=node-deps /app/node_modules ./node_modules

# Copier le code source
COPY . .

# Créer les répertoires de données
RUN mkdir -p \
    .laruche/logs \
    .laruche/rollback \
    agent/memory \
    agent/logs \
    skills/_quarantine \
    data

# Variables d'environnement par défaut
ENV NODE_ENV=production \
    STANDALONE_MODE=true \
    GHOST_OS_MODE=ultimate \
    OLLAMA_HOST=http://host.docker.internal:11434 \
    API_PORT=3000 \
    HUD_PORT=9001 \
    HITL_TIMEOUT_SECONDS=120 \
    VALIDATOR_URL=http://localhost:8014 \
    SWARM_URL=http://localhost:8013 \
    CONSCIOUSNESS_BRIDGE_URL=http://localhost:8016

# Ports exposés — 16 couches Python + Node.js + WS
EXPOSE 3000 \
       8001 8002 8003 8004 8005 8006 8007 \
       8008 8009 8010 8011 8012 \
       8013 8014 8015 8016 \
       9001

# Healthcheck multi-couches (queen Node.js + queen Python + consciousness bridge)
HEALTHCHECK --interval=30s --timeout=15s --start-period=90s --retries=5 \
    CMD curl -sf http://localhost:3000/api/health && \
        curl -sf http://localhost:8001/health && \
        curl -sf http://localhost:8016/health || exit 1

# Point d'entrée — démarre les couches Python puis la queen Node.js
COPY runtime/deployment/docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
CMD ["/entrypoint.sh"]
