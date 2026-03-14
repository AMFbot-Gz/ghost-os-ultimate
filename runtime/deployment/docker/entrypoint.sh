#!/bin/bash
set -e

# Validation du secret obligatoire
if [ -z "$CHIMERA_SECRET" ] || [ "$CHIMERA_SECRET" = "pico-ruche-dev-secret-changez-moi" ]; then
  echo "❌ CHIMERA_SECRET non défini ou valeur par défaut. Générer avec: openssl rand -hex 32"
  exit 1
fi

echo "🚀 Ghost OS Ultimate — Démarrage..."

# Démarrer les couches Python en background
python3 start_agent.py &
PYTHON_PID=$!

# Attendre que les couches Python soient prêtes
echo "⏳ Attente des couches Python..."
for i in $(seq 1 30); do
  if curl -sf http://localhost:8001/health > /dev/null 2>&1; then
    echo "✅ Couches Python prêtes"
    break
  fi
  sleep 1
done

# Démarrer la queen Node.js (foreground)
echo "✅ Démarrage Queen Node.js..."
exec node src/queen_oss.js
