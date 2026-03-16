#!/bin/bash
set -e

# ─── Validation ────────────────────────────────────────────────────────────────
if [ -z "$CHIMERA_SECRET" ] || [ "$CHIMERA_SECRET" = "pico-ruche-dev-secret-changez-moi" ]; then
  echo "❌ CHIMERA_SECRET non défini ou valeur par défaut."
  echo "   Générer avec: openssl rand -hex 32"
  exit 1
fi

echo "🚀 Ghost OS Ultimate v1.0.0 — Démarrage (16 couches Python)"
echo "   Mode : ${GHOST_OS_MODE:-ultimate}"
echo "   Ollama: ${OLLAMA_HOST:-http://host.docker.internal:11434}"

# ─── Couches Python (background) ──────────────────────────────────────────────
echo "🐍 Lancement de start_agent.py..."
python3 start_agent.py &
PYTHON_PID=$!

# ─── Attente des couches critiques ────────────────────────────────────────────
# Ordre : Memory → Brain → Queen → ConsciousnessBridge
echo "⏳ Attente des couches Python..."

wait_for() {
  local name=$1
  local port=$2
  local max_attempts=${3:-60}
  local attempt=0
  while [ $attempt -lt $max_attempts ]; do
    if curl -sf "http://localhost:${port}/health" > /dev/null 2>&1; then
      echo "  ✅ ${name} :${port}"
      return 0
    fi
    attempt=$((attempt + 1))
    sleep 1
  done
  echo "  ⚠️  ${name} :${port} — timeout (${max_attempts}s) — continuons quand même"
  return 0   # non-fatal — les autres couches peuvent continuer
}

# Couches critiques (on attend jusqu'à 90s chacune)
wait_for "Memory"    8006 90
wait_for "Brain"     8003 90
wait_for "Queen"     8001 90

# Couches avancées (attend 60s chacune, non-fatal)
wait_for "Perception"          8002 60
wait_for "Executor"            8004 60
wait_for "Evolution"           8005 60
wait_for "MCPBridge"           8007 60
wait_for "Planner"             8008 60
wait_for "Learner"             8009 60
wait_for "Goals"               8010 60
wait_for "Pipeline"            8011 60
wait_for "Miner"               8012 60
wait_for "SwarmRouter"         8013 60
wait_for "Validator"           8014 60
wait_for "ComputerUse"         8015 60
wait_for "ConsciousnessBridge" 8016 60

# ─── Rapport de santé ──────────────────────────────────────────────────────────
echo ""
echo "📊 État des 16 couches Python :"
LAYERS=("Queen:8001" "Perception:8002" "Brain:8003" "Executor:8004" "Evolution:8005" \
        "Memory:8006" "MCPBridge:8007" "Planner:8008" "Learner:8009" "Goals:8010" \
        "Pipeline:8011" "Miner:8012" "SwarmRouter:8013" "Validator:8014" \
        "ComputerUse:8015" "Consciousness:8016")

online=0
total=${#LAYERS[@]}
for entry in "${LAYERS[@]}"; do
  name="${entry%%:*}"
  port="${entry##*:}"
  if curl -sf "http://localhost:${port}/health" > /dev/null 2>&1; then
    echo "  ✅ ${name} :${port}"
    online=$((online + 1))
  else
    echo "  ❌ ${name} :${port}"
  fi
done
echo "  → ${online}/${total} couches actives"

# ─── Démarrer la Queen Node.js (foreground) ───────────────────────────────────
echo ""
echo "✅ Démarrage Queen Node.js :3000..."
exec node src/queen_oss.js
