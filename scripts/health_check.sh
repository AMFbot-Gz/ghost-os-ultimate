#!/bin/bash
# scripts/health_check.sh — Ghost OS Ultimate v1.0.0
# Vérifie la santé de toutes les couches (Node.js + 16 Python + Ollama)
#
# Usage:
#   bash scripts/health_check.sh              # check complet
#   bash scripts/health_check.sh --json       # sortie JSON
#   bash scripts/health_check.sh --brief      # une ligne par couche
#   bash scripts/health_check.sh --watch 10   # boucle toutes les 10s

# ─── Options ──────────────────────────────────────────────────────────────────
JSON_MODE=false
BRIEF_MODE=false
WATCH_INTERVAL=0

while [[ $# -gt 0 ]]; do
  case $1 in
    --json)   JSON_MODE=true ;;
    --brief)  BRIEF_MODE=true ;;
    --watch)  WATCH_INTERVAL="${2:-10}"; shift ;;
    *) ;;
  esac
  shift
done

# ─── Définition des services ───────────────────────────────────────────────────
declare -A SERVICES=(
  ["Node.js Queen :3000"]="http://localhost:3000/api/health"
  ["👑 Queen Python :8001"]="http://localhost:8001/health"
  ["👁️  Perception :8002"]="http://localhost:8002/health"
  ["🧠 Brain :8003"]="http://localhost:8003/health"
  ["⚙️  Executor :8004"]="http://localhost:8004/health"
  ["🧬 Evolution :8005"]="http://localhost:8005/health"
  ["💾 Memory :8006"]="http://localhost:8006/health"
  ["🔌 MCPBridge :8007"]="http://localhost:8007/health"
  ["🗺️  Planner :8008"]="http://localhost:8008/health"
  ["🎓 Learner :8009"]="http://localhost:8009/health"
  ["🏆 Goals :8010"]="http://localhost:8010/health"
  ["🔗 Pipeline :8011"]="http://localhost:8011/health"
  ["⛏  Miner :8012"]="http://localhost:8012/health"
  ["🐝 SwarmRouter :8013"]="http://localhost:8013/health"
  ["🔬 Validator :8014"]="http://localhost:8014/health"
  ["🖥️  ComputerUse :8015"]="http://localhost:8015/health"
  ["🧠 Consciousness :8016"]="http://localhost:8016/health"
  ["⚡ Optimizer :8017"]="http://localhost:8017/health"
  ["🟠 Ollama :11434"]="http://localhost:11434/api/tags"
)

# Ordre d'affichage
ORDERED_KEYS=(
  "Node.js Queen :3000"
  "👑 Queen Python :8001"
  "👁️  Perception :8002"
  "🧠 Brain :8003"
  "⚙️  Executor :8004"
  "🧬 Evolution :8005"
  "💾 Memory :8006"
  "🔌 MCPBridge :8007"
  "🗺️  Planner :8008"
  "🎓 Learner :8009"
  "🏆 Goals :8010"
  "🔗 Pipeline :8011"
  "⛏  Miner :8012"
  "🐝 SwarmRouter :8013"
  "🔬 Validator :8014"
  "🖥️  ComputerUse :8015"
  "🧠 Consciousness :8016"
  "⚡ Optimizer :8017"
  "🟠 Ollama :11434"
)

# ─── Fonctions ─────────────────────────────────────────────────────────────────

check_service() {
  local url=$1
  local t0=$(date +%s%N)
  local response
  response=$(curl -sf --max-time 4 "$url" 2>/dev/null)
  local exit_code=$?
  local t1=$(date +%s%N)
  local latency_ms=$(( (t1 - t0) / 1000000 ))

  if [ $exit_code -eq 0 ]; then
    echo "ok:$latency_ms"
  else
    echo "down:$latency_ms"
  fi
}

run_check() {
  local timestamp=$(date "+%Y-%m-%d %H:%M:%S")
  local online=0
  local total=${#ORDERED_KEYS[@]}

  if [ "$JSON_MODE" = true ]; then
    echo "{"
    echo "  \"timestamp\": \"$timestamp\","
    echo "  \"services\": {"
    local first=true
    for name in "${ORDERED_KEYS[@]}"; do
      local url="${SERVICES[$name]}"
      local result=$(check_service "$url")
      local status="${result%%:*}"
      local latency="${result##*:}"
      if [ "$status" = "ok" ]; then online=$((online+1)); fi
      if [ "$first" = true ]; then first=false; else echo ","; fi
      printf "    \"%s\": {\"ok\": %s, \"latency_ms\": %s}" \
        "$name" \
        "$([ "$status" = "ok" ] && echo "true" || echo "false")" \
        "$latency"
    done
    echo ""
    echo "  },"
    echo "  \"online\": $online,"
    echo "  \"total\": $total"
    echo "}"
    return
  fi

  if [ "$BRIEF_MODE" = false ]; then
    echo ""
    echo "╔═══════════════════════════════════════════════════════════════╗"
    echo "║  Ghost OS Ultimate — Health Check  $timestamp  ║"
    echo "╚═══════════════════════════════════════════════════════════════╝"
    echo ""
  fi

  declare -A results
  declare -A latencies

  for name in "${ORDERED_KEYS[@]}"; do
    local url="${SERVICES[$name]}"
    local result=$(check_service "$url")
    local status="${result%%:*}"
    local latency="${result##*:}"
    results[$name]=$status
    latencies[$name]=$latency
    if [ "$status" = "ok" ]; then online=$((online+1)); fi
  done

  for name in "${ORDERED_KEYS[@]}"; do
    local status="${results[$name]}"
    local latency="${latencies[$name]}"
    if [ "$status" = "ok" ]; then
      printf "  ✅  %-30s %4sms\n" "$name" "$latency"
    else
      printf "  ❌  %-30s offline\n" "$name"
    fi
  done

  echo ""
  echo "  ──────────────────────────────────────────────"
  local pct=$(( online * 100 / total ))
  if [ $online -eq $total ]; then
    echo "  🟢  $online/$total services actifs ($pct%) — ESSAIM PLEINEMENT OPÉRATIONNEL"
  elif [ $online -ge $(( total * 2 / 3 )) ]; then
    echo "  🟡  $online/$total services actifs ($pct%) — DÉGRADÉ"
  else
    echo "  🔴  $online/$total services actifs ($pct%) — CRITIQUE"
  fi
  echo ""

  # Conseils de debug
  if [ $online -lt $total ]; then
    echo "  💡 Pour diagnostiquer :"
    echo "     python3 scripts/status_agent.py"
    echo "     tail -f agent/logs/brain.log"
    echo "     python3 start_agent.py    # (re)démarrer les couches Python"
    echo "     node src/queen_oss.js     # (re)démarrer la queen Node.js"
    echo ""
  fi
}

# ─── Point d'entrée ───────────────────────────────────────────────────────────

if [ "$WATCH_INTERVAL" -gt 0 ] 2>/dev/null; then
  echo "👁️  Watch mode — actualisation toutes les ${WATCH_INTERVAL}s (Ctrl+C pour arrêter)"
  while true; do
    clear
    run_check
    sleep "$WATCH_INTERVAL"
  done
else
  run_check
fi
