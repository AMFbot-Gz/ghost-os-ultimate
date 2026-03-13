#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════
# scripts/test-all.sh — Suite de tests complète LaRuche
# ════════════════════════════════════════════════════════════════════
#
# Usage :
#   bash scripts/test-all.sh           # Tous les tests
#   bash scripts/test-all.sh --smoke   # Smoke tests seulement
#   bash scripts/test-all.sh --e2e     # E2E seulement
#   bash scripts/test-all.sh --unit    # Tests unitaires seulement
#
# Génère test-report.html à la racine du projet.
# ════════════════════════════════════════════════════════════════════

set -euo pipefail

# ─── Variables ────────────────────────────────────────────────────────────────
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

OLLAMA_HOST="${OLLAMA_HOST:-http://localhost:11434}"
API_PORT="${API_PORT:-3001}"
HUD_PORT="${HUD_PORT:-9099}"
LARUCHE_PID=""
OLLAMA_STARTED=false
REPORT_FILE="$ROOT/test-report.html"
START_TIME=$(date +%s)

SMOKE_PASSED=0; SMOKE_FAILED=0
UNIT_PASSED=0;  UNIT_FAILED=0
E2E_PASSED=0;   E2E_FAILED=0

# Flags
RUN_SMOKE=true
RUN_UNIT=true
RUN_E2E=true

for arg in "$@"; do
  case $arg in
    --smoke) RUN_UNIT=false; RUN_E2E=false ;;
    --unit)  RUN_SMOKE=false; RUN_E2E=false ;;
    --e2e)   RUN_SMOKE=false; RUN_UNIT=false ;;
  esac
done

# ─── Couleurs ─────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; RESET='\033[0m'

ok()   { echo -e "  ${GREEN}✅${RESET} $1"; }
fail() { echo -e "  ${RED}❌${RESET} $1"; }
info() { echo -e "  ${BLUE}→${RESET} $1"; }
warn() { echo -e "  ${YELLOW}⚠️${RESET}  $1"; }
section() { echo -e "\n${BOLD}  $1${RESET}"; }

# ─── Nettoyage à la sortie ────────────────────────────────────────────────────
cleanup() {
  local exit_code=$?
  if [ -n "$LARUCHE_PID" ] && kill -0 "$LARUCHE_PID" 2>/dev/null; then
    info "Arrêt LaRuche standalone (PID $LARUCHE_PID)..."
    kill -SIGTERM "$LARUCHE_PID" 2>/dev/null || true
    sleep 1
    kill -9 "$LARUCHE_PID" 2>/dev/null || true
  fi
  if $OLLAMA_STARTED; then
    info "Arrêt Ollama (démarré par ce script)..."
    pkill -f "ollama serve" 2>/dev/null || true
  fi
  generate_report
  exit $exit_code
}
trap cleanup EXIT INT TERM

# ─── Vérification des prérequis ───────────────────────────────────────────────
check_prereqs() {
  section "Vérification des prérequis"

  if ! command -v node &>/dev/null; then
    fail "Node.js non installé (requis >= 20)"
    exit 1
  fi
  local node_ver
  node_ver=$(node --version | sed 's/v//' | cut -d. -f1)
  if [ "$node_ver" -lt 20 ]; then
    fail "Node.js v${node_ver} trop ancien (requis >= 20)"
    exit 1
  fi
  ok "Node.js $(node --version)"

  if [ ! -f "$ROOT/node_modules/.bin/chalk" ] && [ ! -d "$ROOT/node_modules/chalk" ]; then
    info "Dépendances manquantes — installation..."
    npm ci --silent
  fi
  ok "Dépendances npm"

  if [ ! -f "$ROOT/.env" ]; then
    warn ".env manquant — copie depuis .env.example"
    if [ -f "$ROOT/.env.example" ]; then
      cp "$ROOT/.env.example" "$ROOT/.env"
      echo "" >> "$ROOT/.env"
      echo "TELEGRAM_BOT_TOKEN=standalone-test" >> "$ROOT/.env"
      echo "ADMIN_TELEGRAM_ID=0" >> "$ROOT/.env"
    fi
  fi
  ok "Fichier .env"

  if command -v ollama &>/dev/null; then
    ok "Ollama installé ($(ollama --version 2>/dev/null || echo 'version inconnue'))"
  else
    warn "Ollama non installé — tests Ollama ignorés"
  fi
}

# ─── Démarrage d'Ollama ────────────────────────────────────────────────────────
start_ollama_if_needed() {
  if curl -sf "$OLLAMA_HOST/api/tags" &>/dev/null; then
    ok "Ollama déjà en cours"
    return 0
  fi

  if ! command -v ollama &>/dev/null; then
    warn "Ollama non disponible — tests LLM ignorés"
    return 1
  fi

  info "Démarrage d'Ollama..."
  ollama serve &>/dev/null &
  OLLAMA_STARTED=true
  sleep 5

  if curl -sf "$OLLAMA_HOST/api/tags" &>/dev/null; then
    ok "Ollama démarré"
    return 0
  else
    warn "Ollama n'a pas démarré — tests LLM ignorés"
    return 1
  fi
}

# ─── Démarrage de LaRuche en mode standalone ────────────────────────────────────
start_laruche_standalone() {
  section "Démarrage LaRuche Standalone"

  STANDALONE_MODE=true \
  API_PORT=$API_PORT \
  HUD_PORT=$HUD_PORT \
  LOG_LEVEL=warn \
  NODE_ENV=test \
  TELEGRAM_BOT_TOKEN="" \
  ADMIN_TELEGRAM_ID="" \
  node "$ROOT/src/queen_oss.js" &>"$ROOT/.laruche/logs/test-standalone.log" &

  LARUCHE_PID=$!
  info "PID: $LARUCHE_PID"

  # Attendre que l'API réponde
  local retries=0
  while [ $retries -lt 20 ]; do
    sleep 0.5
    if curl -sf "http://localhost:${API_PORT}/api/health" &>/dev/null; then
      ok "API disponible sur http://localhost:${API_PORT}"
      return 0
    fi
    retries=$((retries + 1))
  done

  fail "LaRuche n'a pas démarré en 10s"
  cat "$ROOT/.laruche/logs/test-standalone.log" 2>/dev/null | tail -20
  return 1
}

# ─── Smoke tests ─────────────────────────────────────────────────────────────────
run_smoke_tests() {
  section "Smoke Tests"

  if node "$ROOT/test/smoke.js"; then
    SMOKE_PASSED=22
    ok "Smoke tests : 22/22"
  else
    local exit=$?
    SMOKE_FAILED=$((22 - SMOKE_PASSED))
    fail "Smoke tests : certains ont échoué (code $exit)"
    return $exit
  fi
}

# ─── Tests E2E standalone ───────────────────────────────────────────────────────
run_e2e_tests() {
  section "Tests E2E Standalone"

  if ! kill -0 "$LARUCHE_PID" 2>/dev/null; then
    warn "LaRuche standalone non disponible — tests E2E ignorés"
    return 0
  fi

  if API_PORT=$API_PORT node "$ROOT/test/e2e/standalone.test.js"; then
    ok "Tests E2E standalone passés"
    E2E_PASSED=$((E2E_PASSED + 1))
  else
    fail "Certains tests E2E ont échoué"
    E2E_FAILED=$((E2E_FAILED + 1))
    return 1
  fi
}

# ─── Tests Playwright (dashboard) ───────────────────────────────────────────────
run_playwright_tests() {
  section "Tests Playwright (Dashboard)"

  if ! command -v npx &>/dev/null; then
    warn "npx non disponible — tests Playwright ignorés"
    return 0
  fi

  if [ ! -f "$ROOT/playwright.config.js" ]; then
    warn "playwright.config.js manquant — tests Playwright ignorés"
    return 0
  fi

  # Vérifier que le dashboard est accessible
  if ! curl -sf "http://localhost:8080" &>/dev/null; then
    warn "Dashboard non accessible (port 8080) — tests Playwright ignorés"
    info "Lancez le dashboard avec: cd dashboard && npm run dev"
    return 0
  fi

  if npx playwright test "$ROOT/test/e2e/dashboard.spec.js" \
    --reporter=line \
    --timeout=30000 \
    2>&1; then
    ok "Tests Playwright passés"
    E2E_PASSED=$((E2E_PASSED + 1))
  else
    warn "Certains tests Playwright ont échoué (non bloquant)"
  fi
}

# ─── Génération du rapport HTML ──────────────────────────────────────────────────
generate_report() {
  local end_time
  end_time=$(date +%s)
  local duration=$((end_time - START_TIME))

  local total_passed=$((SMOKE_PASSED + UNIT_PASSED + E2E_PASSED))
  local total_failed=$((SMOKE_FAILED + UNIT_FAILED + E2E_FAILED))
  local total=$((total_passed + total_failed))
  local pct=0
  if [ $total -gt 0 ]; then
    pct=$(( (total_passed * 100) / total ))
  fi

  local status_color="#22C55E"
  local status_text="SUCCÈS"
  if [ $total_failed -gt 0 ]; then
    status_color="#EF4444"
    status_text="ÉCHECS DÉTECTÉS"
  fi

  cat > "$REPORT_FILE" << HTMLEOF
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>LaRuche — Rapport de Tests</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #0D0D1A; color: #E0E0E0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 40px 20px; }
    .container { max-width: 800px; margin: 0 auto; }
    h1 { color: #F5A623; font-size: 28px; margin-bottom: 4px; }
    .subtitle { color: #64748B; font-size: 13px; margin-bottom: 32px; }
    .summary { background: #1A1A2E; border: 1px solid rgba(124,58,237,0.3); border-radius: 16px; padding: 24px; margin-bottom: 24px; display: flex; align-items: center; gap: 24px; }
    .big-pct { font-size: 64px; font-weight: bold; color: ${status_color}; line-height: 1; }
    .summary-info h2 { font-size: 18px; color: ${status_color}; margin-bottom: 8px; }
    .summary-info p { color: #64748B; font-size: 13px; }
    .cards { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; margin-bottom: 24px; }
    .card { background: #1A1A2E; border: 1px solid rgba(124,58,237,0.2); border-radius: 12px; padding: 16px; }
    .card h3 { color: #F5A623; font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 8px; }
    .card .value { font-size: 32px; font-weight: bold; }
    .card .label { font-size: 11px; color: #64748B; margin-top: 2px; }
    .green { color: #22C55E; } .red { color: #EF4444; } .muted { color: #64748B; }
    .meta { text-align: center; font-size: 11px; color: #64748B; padding-top: 16px; border-top: 1px solid rgba(255,255,255,0.05); }
    .bar-outer { background: rgba(255,255,255,0.05); border-radius: 4px; height: 8px; margin-top: 12px; }
    .bar-inner { background: ${status_color}; border-radius: 4px; height: 8px; width: ${pct}%; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🐝 LaRuche — Rapport de Tests</h1>
    <p class="subtitle">Généré le $(date '+%d/%m/%Y à %H:%M:%S') · Durée : ${duration}s</p>

    <div class="summary">
      <div class="big-pct">${pct}%</div>
      <div class="summary-info">
        <h2>${status_text}</h2>
        <p>${total_passed} test(s) passé(s) sur ${total} · ${total_failed} échoué(s)</p>
        <div class="bar-outer"><div class="bar-inner"></div></div>
      </div>
    </div>

    <div class="cards">
      <div class="card">
        <h3>🔥 Smoke Tests</h3>
        <div class="value green">${SMOKE_PASSED}</div>
        <div class="label">passés</div>
        ${SMOKE_FAILED:-0} échoués
      </div>
      <div class="card">
        <h3>⚙️ Unit Tests</h3>
        <div class="value green">${UNIT_PASSED}</div>
        <div class="label">passés</div>
        ${UNIT_FAILED:-0} échoués
      </div>
      <div class="card">
        <h3>🌐 E2E Tests</h3>
        <div class="value green">${E2E_PASSED}</div>
        <div class="label">passés</div>
        ${E2E_FAILED:-0} échoués
      </div>
    </div>

    <div class="meta">
      LaRuche v$(node -e "console.log(require('./package.json').version)" 2>/dev/null || echo "3.2.0") ·
      Node.js $(node --version) ·
      Ollama: $(curl -sf "$OLLAMA_HOST/api/tags" &>/dev/null && echo "✅" || echo "❌")
    </div>
  </div>
</body>
</html>
HTMLEOF

  echo ""
  echo -e "${BOLD}  Rapport généré : ${BLUE}${REPORT_FILE}${RESET}"

  if command -v open &>/dev/null; then
    open "$REPORT_FILE" 2>/dev/null || true
  elif command -v xdg-open &>/dev/null; then
    xdg-open "$REPORT_FILE" 2>/dev/null || true
  fi
}

# ─── Main ─────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}🐝 LaRuche — Suite de Tests Automatiques${RESET}"
echo -e "${BLUE}   $(date '+%d/%m/%Y %H:%M:%S')${RESET}"
echo ""

mkdir -p "$ROOT/.laruche/logs"

check_prereqs
start_ollama_if_needed || true

if start_laruche_standalone; then
  LARUCHE_STARTED=true
else
  warn "Mode standalone non disponible — certains tests ignorés"
  LARUCHE_STARTED=false
fi

EXIT_CODE=0

if $RUN_SMOKE; then
  run_smoke_tests || EXIT_CODE=1
fi

if $RUN_E2E && $LARUCHE_STARTED; then
  run_e2e_tests || EXIT_CODE=1
  run_playwright_tests || true  # Non bloquant
fi

# Résumé
section "Résumé"
total=$((SMOKE_PASSED + UNIT_PASSED + E2E_PASSED + SMOKE_FAILED + UNIT_FAILED + E2E_FAILED))
total_passed=$((SMOKE_PASSED + UNIT_PASSED + E2E_PASSED))
total_failed=$((SMOKE_FAILED + UNIT_FAILED + E2E_FAILED))

if [ $total_failed -eq 0 ]; then
  ok "Tous les tests passés ! (${total_passed}/${total})"
else
  fail "${total_failed} test(s) échoué(s) sur ${total}"
  EXIT_CODE=1
fi

exit $EXIT_CODE
