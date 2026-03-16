#!/usr/bin/env bash
# scripts/setup_7day_autonomy.sh — Configure l'autonomie 7 jours de Ghost OS
# ═══════════════════════════════════════════════════════════════════════════════
#
# Ce script configure automatiquement :
#   ✓ Cron jobs (dream_cycle toutes les heures, architect_cycle tous les dimanches)
#   ✓ Launchd plist macOS pour self_healing_daemon (restart auto)
#   ✓ PM2 pour Queen Node.js (restart auto)
#   ✓ Log rotation (logrotate ou manuel)
#   ✓ Préflight check final
#
# Usage: bash scripts/setup_7day_autonomy.sh
# ═══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON3="$(which python3)"
LOG_DIR="$ROOT/agent/logs"
LAUNCHD_DIR="$HOME/Library/LaunchAgents"

GREEN='\033[0;32m' YELLOW='\033[0;33m' RED='\033[0;31m' BLUE='\033[0;34m' NC='\033[0m' BOLD='\033[1m'
ok()   { echo -e "  ${GREEN}✅${NC} $1"; }
warn() { echo -e "  ${YELLOW}⚠️ ${NC} $1"; }
err()  { echo -e "  ${RED}❌${NC} $1"; }
info() { echo -e "  ${BLUE}ℹ️ ${NC} $1"; }

echo -e "\n${BOLD}${BLUE}╔══════════════════════════════════════════════════════╗"
echo -e "║  Ghost OS Ultimate — Setup Autonomie 7 Jours        ║"
echo -e "╚══════════════════════════════════════════════════════╝${NC}\n"

mkdir -p "$LOG_DIR" "$LAUNCHD_DIR"

# ── 1. Préflight ──────────────────────────────────────────────────────────────
echo "1. Vérification prérequis"

check_cmd() { command -v "$1" &>/dev/null && ok "$1 trouvé" || warn "$1 absent"; }
check_cmd python3
check_cmd node
check_cmd npm
check_cmd uvicorn || python3 -m uvicorn --version &>/dev/null && ok "uvicorn OK" || warn "uvicorn absent (pip install uvicorn)"
check_cmd pm2 || warn "pm2 absent — npm install -g pm2"

# Vérifier les layers critiques
echo ""
info "Test layers critiques..."
$PYTHON3 scripts/self_healing_daemon.py --once 2>/dev/null || warn "Certains layers sont down (normal si pas encore démarrés)"

# ── 2. PM2 pour Queen Node.js ─────────────────────────────────────────────────
echo ""
echo "2. PM2 — Queen Node.js"

if command -v pm2 &>/dev/null; then
  cd "$ROOT"
  pm2 delete ghost-queen 2>/dev/null || true
  pm2 start src/queen_oss.js \
    --name ghost-queen \
    --log "$LOG_DIR/queen_node.log" \
    --error "$LOG_DIR/queen_node_err.log" \
    --restart-delay 3000 \
    --max-memory-restart 500M \
    --env NODE_ENV=production \
    --env STANDALONE_MODE=true \
    -- 2>/dev/null || true
  pm2 save 2>/dev/null || true
  pm2 startup 2>/dev/null | tail -1 || true
  ok "PM2 queen configuré (auto-restart)"
else
  warn "PM2 non installé — Queen Node.js pas en auto-restart"
  info "→ npm install -g pm2 && pm2 start src/queen_oss.js --name ghost-queen"
fi

# ── 3. Launchd pour self_healing_daemon ───────────────────────────────────────
echo ""
echo "3. macOS LaunchAgent — Self-Healing Daemon"

PLIST_PATH="$LAUNCHD_DIR/com.ghost-os.self-healing.plist"
cat > "$PLIST_PATH" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.ghost-os.self-healing</string>

  <key>ProgramArguments</key>
  <array>
    <string>${PYTHON3}</string>
    <string>${ROOT}/scripts/self_healing_daemon.py</string>
  </array>

  <key>WorkingDirectory</key>
  <string>${ROOT}</string>

  <key>RunAtLoad</key>
  <true/>

  <key>KeepAlive</key>
  <true/>

  <key>StandardOutPath</key>
  <string>${LOG_DIR}/self_healing.log</string>

  <key>StandardErrorPath</key>
  <string>${LOG_DIR}/self_healing_err.log</string>

  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin</string>
  </dict>

  <key>ThrottleInterval</key>
  <integer>30</integer>
</dict>
</plist>
PLIST

launchctl unload "$PLIST_PATH" 2>/dev/null || true
launchctl load "$PLIST_PATH" 2>/dev/null && ok "Self-healing daemon chargé (LaunchAgent)" \
  || warn "launchctl load échoué — relancer manuellement: launchctl load $PLIST_PATH"

# ── 4. Cron Jobs ──────────────────────────────────────────────────────────────
echo ""
echo "4. Cron Jobs"

CRON_DREAM="0 * * * * cd ${ROOT} && ${PYTHON3} scripts/dream_cycle.py --limit 30 >> ${LOG_DIR}/dream_cycle.log 2>&1"
CRON_ARCHITECT="0 3 * * 0 cd ${ROOT} && ${PYTHON3} scripts/architect_weekly_cycle.py >> ${LOG_DIR}/architect_cycle.log 2>&1"
CRON_PREFLIGHT="@reboot sleep 30 && cd ${ROOT} && ${PYTHON3} scripts/preflight_cu.py >> ${LOG_DIR}/preflight.log 2>&1"

# Ajouter sans doublons
add_cron() {
  local cron_line="$1"
  local marker="$2"
  (crontab -l 2>/dev/null | grep -v "$marker"; echo "$cron_line") | crontab -
}

add_cron "$CRON_DREAM"      "dream_cycle.py"
add_cron "$CRON_ARCHITECT"  "architect_weekly_cycle.py"
add_cron "$CRON_PREFLIGHT"  "preflight_cu.py"

ok "Cron jobs configurés:"
info "  Toutes les heures  : dream_cycle (extraction heuristiques)"
info "  Dimanche 3h00      : architect_weekly_cycle (nourrit la ruche)"
info "  Au démarrage       : preflight_cu (auto-config)"

# ── 5. Python layers via start_agent.py ───────────────────────────────────────
echo ""
echo "5. Python Layers — Launchd"

PLIST_PYTHON="$LAUNCHD_DIR/com.ghost-os.python-layers.plist"
cat > "$PLIST_PYTHON" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.ghost-os.python-layers</string>

  <key>ProgramArguments</key>
  <array>
    <string>${PYTHON3}</string>
    <string>${ROOT}/start_agent.py</string>
  </array>

  <key>WorkingDirectory</key>
  <string>${ROOT}</string>

  <key>RunAtLoad</key>
  <true/>

  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>

  <key>StandardOutPath</key>
  <string>${LOG_DIR}/python_layers.log</string>

  <key>StandardErrorPath</key>
  <string>${LOG_DIR}/python_layers_err.log</string>

  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin:/Library/Frameworks/Python.framework/Versions/3.12/bin</string>
  </dict>

  <key>ThrottleInterval</key>
  <integer>60</integer>
</dict>
</plist>
PLIST

launchctl unload "$PLIST_PYTHON" 2>/dev/null || true
launchctl load "$PLIST_PYTHON" 2>/dev/null && ok "Python layers configurés (LaunchAgent)" \
  || warn "launchctl load Python layers échoué"

# ── 6. Log rotation ────────────────────────────────────────────────────────────
echo ""
echo "6. Log rotation"

LOG_ROTATE_SCRIPT="$ROOT/scripts/rotate_logs.sh"
cat > "$LOG_ROTATE_SCRIPT" << 'ROTATE'
#!/usr/bin/env bash
# Rotation manuelle des logs Ghost OS (lancé par cron hebdo)
LOG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../agent/logs" && pwd)"
MAX_SIZE_MB=10

for log in "$LOG_DIR"/*.log; do
  [[ -f "$log" ]] || continue
  size_kb=$(du -k "$log" | cut -f1)
  if [[ $size_kb -gt $((MAX_SIZE_MB * 1024)) ]]; then
    mv "$log" "${log}.$(date +%Y%m%d).bak"
    gzip "${log}.$(date +%Y%m%d).bak" 2>/dev/null || true
    echo "Rotated: $log"
  fi
done
# Supprimer les .bak.gz plus vieux que 30 jours
find "$LOG_DIR" -name "*.bak.gz" -mtime +30 -delete 2>/dev/null || true
ROTATE
chmod +x "$LOG_ROTATE_SCRIPT"

# Ajouter rotation hebdo au cron
CRON_ROTATE="0 4 * * 1 bash ${ROOT}/scripts/rotate_logs.sh >> /tmp/ghost_logrotate.log 2>&1"
(crontab -l 2>/dev/null | grep -v "rotate_logs.sh"; echo "$CRON_ROTATE") | crontab -
ok "Log rotation configurée (lundi 4h, max 10MB par fichier)"

# ── 7. Résumé final ────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}━━━ Résumé Autonomie 7 Jours ━━━${NC}"
echo ""
echo "  QUOI                    QUAND                   COMMENT"
echo "  ──────────────────────────────────────────────────────────────────"
echo "  Python layers           Au boot + KeepAlive     LaunchAgent"
echo "  Self-healing daemon     Continu (10s checks)    LaunchAgent"
echo "  Queen Node.js           Au boot + restart       PM2"
echo "  Dream cycle             Toutes les heures       Cron"
echo "  Architect weekly cycle  Dimanche 3h00           Cron"
echo "  Preflight CU            Au démarrage            Cron @reboot"
echo "  Log rotation            Lundi 4h00              Cron"
echo ""
echo "  Logs:  $LOG_DIR/"
echo "  Plists: $LAUNCHD_DIR/com.ghost-os.*.plist"
echo ""
echo -e "  ${GREEN}${BOLD}✅ Ghost OS Ultimate est configuré pour 7 jours d'autonomie${NC}"
echo -e "  ${BLUE}ℹ️  Redémarre ton Mac pour activer tous les LaunchAgents${NC}"
echo ""
