#!/bin/bash
# start-picoclaw.sh — Démarrer le satellite PicoClaw
set -e

PICO_BIN="$HOME/picoclaw"
PICO_CONFIG="$HOME/picoclaw-config"

if [ ! -f "$PICO_BIN" ]; then
  echo "⚠️  PicoClaw binaire non trouvé : $PICO_BIN"
  echo "    Installer : curl -L https://github.com/sipeed/picoclaw/releases/latest/download/picoclaw_Darwin_arm64.tar.gz | tar xz -C ~"
  exit 1
fi

export PICOCLAW_HOME="$PICO_CONFIG"
echo "🚀 Démarrage PicoClaw satellite sur :8090..."
"$PICO_BIN" gateway --config "$PICO_CONFIG/config.json" &
PICO_PID=$!
echo "PicoClaw PID: $PICO_PID"
echo "Health: curl http://localhost:8090/health"
