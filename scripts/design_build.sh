#!/usr/bin/env bash
# =============================================================================
# design_build.sh — LaRuche Design Build Script
# Lance les agents de design Pencil pour générer les fichiers .pen
# et construire le dashboard + HUD
# =============================================================================

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$ROOT/.laruche/logs"
LOG_FILE="$LOG_DIR/design_build.log"
DASHBOARD_DIR="$ROOT/dashboard"
HUD_DIR="$ROOT/hud"
CONFIG_FILE="$ROOT/config/pencil_agents.json"

# Couleurs terminal
RED='\033[0;31m'
GREEN='\033[0;32m'
AMBER='\033[0;33m'
BLUE='\033[0;34m'
VIOLET='\033[0;35m'
CYAN='\033[0;36m'
RESET='\033[0m'
BOLD='\033[1m'

# ─── Fonctions utilitaires ────────────────────────────────────────────────────

log() {
  local level="$1"
  local message="$2"
  local timestamp
  timestamp=$(date '+%Y-%m-%d %H:%M:%S')
  echo "[$timestamp] [$level] $message" >> "$LOG_FILE"
  case "$level" in
    INFO)  echo -e "${CYAN}[INFO]${RESET}  $message" ;;
    OK)    echo -e "${GREEN}[OK]${RESET}    $message" ;;
    WARN)  echo -e "${AMBER}[WARN]${RESET}  $message" ;;
    ERROR) echo -e "${RED}[ERROR]${RESET} $message" ;;
    STEP)  echo -e "${VIOLET}${BOLD}[STEP]${RESET}  $message" ;;
  esac
}

header() {
  echo ""
  echo -e "${BOLD}${AMBER}╔══════════════════════════════════════════════╗${RESET}"
  echo -e "${BOLD}${AMBER}║  🎨 LaRuche Design Build — $(date '+%H:%M:%S')          ║${RESET}"
  echo -e "${BOLD}${AMBER}╚══════════════════════════════════════════════╝${RESET}"
  echo ""
}

check_ollama() {
  log "STEP" "Vérification Ollama..."
  if curl -sf http://localhost:11434/api/tags > /dev/null 2>&1; then
    log "OK" "Ollama actif"
    return 0
  else
    log "WARN" "Ollama non disponible — génération .pen désactivée"
    return 1
  fi
}

generate_pen_file() {
  local component="$1"
  local output_dir="$2"
  local agent_type="$3"  # wireframe, style, component

  local output_file="$output_dir/${component}.pen"
  log "INFO" "Génération ${component}.pen via agent $agent_type..."

  # Requête Ollama pour générer le wireframe/spec
  local prompt
  case "$agent_type" in
    wireframe)
      prompt="Génère un wireframe ASCII détaillé pour le composant React '${component}' du projet LaRuche (dashboard sombre terracotta, agents IA). Inclus structure, layout, états (idle/active/loading/error), et props API."
      ;;
    style)
      prompt="Génère les spécifications CSS pour le composant '${component}' en utilisant les variables CSS LaRuche: --bg #1A1915, --primary #E07B54, --text #F2F0EA. Inclus responsive + animations."
      ;;
    *)
      prompt="Décris l'architecture du composant React '${component}' pour LaRuche: props, état, hooks, mock data, et accessibilité."
      ;;
  esac

  local response
  response=$(curl -sf http://localhost:11434/api/generate \
    -H 'Content-Type: application/json' \
    -d "{\"model\":\"llama3.2\",\"prompt\":\"$prompt\",\"stream\":false,\"options\":{\"temperature\":0.3}}" \
    2>/dev/null | python3 -c "import sys,json; data=json.load(sys.stdin); print(data.get('response',''))" 2>/dev/null || echo "")

  if [ -n "$response" ]; then
    {
      echo "# ${component} — Design Spec"
      echo "# Generated: $(date '+%Y-%m-%d %H:%M:%S')"
      echo "# Agent: $agent_type"
      echo "# ============================================"
      echo ""
      echo "$response"
    } > "$output_file"
    log "OK" "${component}.pen généré (${#response} chars)"
  else
    {
      echo "# ${component} — Design Spec"
      echo "# Generated: $(date '+%Y-%m-%d %H:%M:%S')"
      echo "# Status: pending (Ollama non disponible)"
      echo "# ============================================"
      echo ""
      echo "## Composant: $component"
      echo ""
      echo "Ce fichier sera rempli lors du prochain build avec Ollama actif."
      echo "Voir config/design-spec.md pour les spécifications manuelles."
    } > "$output_file"
    log "WARN" "${component}.pen créé (placeholder)"
  fi
}

build_dashboard() {
  log "STEP" "Build Dashboard (React + Vite)..."

  if [ ! -d "$DASHBOARD_DIR" ]; then
    log "ERROR" "Dashboard dir introuvable: $DASHBOARD_DIR"
    return 1
  fi

  cd "$DASHBOARD_DIR"

  # Install dependencies if needed
  if [ ! -d "node_modules" ] || [ "package.json" -nt "node_modules" ]; then
    log "INFO" "Installation des dépendances dashboard..."
    npm install --silent 2>> "$LOG_FILE" && log "OK" "npm install OK" || {
      log "ERROR" "npm install échoué"
      return 1
    }
  fi

  # Build
  log "INFO" "Vite build..."
  npm run build 2>> "$LOG_FILE" && log "OK" "Dashboard build OK → dist/" || {
    log "ERROR" "Vite build échoué — voir $LOG_FILE"
    return 1
  }

  cd "$ROOT"
}

build_hud() {
  log "STEP" "Build HUD (Electron)..."

  if [ ! -d "$HUD_DIR" ]; then
    log "WARN" "HUD dir introuvable: $HUD_DIR — skipping"
    return 0
  fi

  cd "$HUD_DIR"

  if [ -f "package.json" ]; then
    if [ ! -d "node_modules" ]; then
      log "INFO" "Installation des dépendances HUD..."
      npm install --silent 2>> "$LOG_FILE" && log "OK" "HUD npm install OK" || {
        log "WARN" "HUD npm install échoué"
      }
    fi

    if npm run build 2>> "$LOG_FILE"; then
      log "OK" "HUD build OK"
    else
      log "WARN" "HUD build skippé (pas de script build défini)"
    fi
  else
    log "WARN" "HUD package.json absent — skipping"
  fi

  cd "$ROOT"
}

# ─── Point d'entrée ──────────────────────────────────────────────────────────

main() {
  # Setup logs
  mkdir -p "$LOG_DIR"
  echo "" >> "$LOG_FILE"
  log "INFO" "=== Design Build démarré ==="

  header

  # 1. Génération des fichiers .pen (design specs)
  log "STEP" "Génération des fichiers .pen..."

  local ollama_ok=false
  check_ollama && ollama_ok=true

  # Dashboard components
  local dashboard_components=("StatusGrid" "MissionFeed" "CostMeter" "TelegramConsole")
  for component in "${dashboard_components[@]}"; do
    generate_pen_file "$component" "$ROOT/dashboard/designs" "wireframe"
  done

  # HUD components
  local hud_components=("HUDOverlay" "HITLModal")
  for component in "${hud_components[@]}"; do
    generate_pen_file "$component" "$ROOT/hud/designs" "wireframe"
  done

  echo ""
  log "OK" "Fichiers .pen générés dans dashboard/designs/ et hud/designs/"

  # 2. Build dashboard
  echo ""
  build_dashboard

  # 3. Build HUD
  echo ""
  build_hud

  # Résumé
  echo ""
  echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════╗${RESET}"
  echo -e "${GREEN}${BOLD}║  ✅ Design Build terminé                     ║${RESET}"
  echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════╝${RESET}"
  echo ""
  echo -e "  ${CYAN}Dashboard:${RESET} $DASHBOARD_DIR/dist/"
  echo -e "  ${CYAN}Designs:${RESET}   $ROOT/dashboard/designs/ + $ROOT/hud/designs/"
  echo -e "  ${CYAN}Logs:${RESET}      $LOG_FILE"
  echo ""

  log "INFO" "=== Design Build terminé ==="
}

main "$@"
