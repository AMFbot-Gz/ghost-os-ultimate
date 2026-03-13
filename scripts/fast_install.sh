#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════
# 🐝  LaRuche Fast-Install
#     One-click setup for macOS and Linux
#     Options:
#       --dry-run    Check prerequisites only (no installs)
#       --headless   Skip Electron/HUD deps
#       --no-models  Skip Ollama model pulls
# ════════════════════════════════════════════════════════════════════
set -euo pipefail

# ─── Colors ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; RESET='\033[0m'
OK="${GREEN}✓${RESET}"; WARN="${YELLOW}⚠${RESET}"; ERR="${RED}✗${RESET}"

# ─── Flags ───────────────────────────────────────────────────────────────────
DRY_RUN=false; HEADLESS=false; NO_MODELS=false
for arg in "$@"; do
  case "$arg" in
    --dry-run)    DRY_RUN=true ;;
    --headless)   HEADLESS=true ;;
    --no-models)  NO_MODELS=true ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"
OS=$(uname -s); ARCH=$(uname -m)

step() { echo -e "\n${BLUE}${BOLD}[$1/8]${RESET} $2"; }
ok()   { echo -e "  ${OK} $1"; }
warn() { echo -e "  ${WARN} $1"; }
fail() { echo -e "  ${ERR} ${RED}$1${RESET}"; }
die()  { echo -e "\n${RED}${BOLD}ERROR:${RESET} $1\n→ $2\n"; exit 1; }

echo -e "\n${BOLD}🐝  LaRuche Fast-Install${RESET}"
echo -e "    ${BLUE}$OS $ARCH${RESET}"
[[ "$DRY_RUN" == true ]] && echo -e "    ${YELLOW}[DRY-RUN mode — no changes]${RESET}"
echo ""

# ─── STEP 1: Node.js 20+ ─────────────────────────────────────────────────────
step 1 "Node.js 20+"
if node --version 2>/dev/null | grep -qE "v(2[0-9])"; then
  ok "Node.js $(node --version)"
else
  NODE_VER=$(node --version 2>/dev/null || echo "not found")
  if [[ "$DRY_RUN" == true ]]; then
    fail "Node.js $NODE_VER (need v20+)"
    fail "Install: https://nodejs.org  or  brew install node@20"
  else
    warn "Node.js $NODE_VER found — installing v20 via nvm..."
    if command -v brew &>/dev/null; then
      brew install node@20 || die "brew install node@20 failed" "Try: brew update && brew install node@20"
      export PATH="/opt/homebrew/opt/node@20/bin:$PATH"
    elif command -v nvm &>/dev/null; then
      nvm install 20 && nvm use 20
    else
      die "Node.js 20+ required" "Install from https://nodejs.org or run: curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash"
    fi
  fi
  ok "Node.js $(node --version)"
fi

# ─── STEP 2: Python 3.9+ ─────────────────────────────────────────────────────
step 2 "Python 3.9+"
if python3 --version 2>/dev/null | grep -qE "3\.(9|1[0-9]|[2-9][0-9])"; then
  ok "Python $(python3 --version)"
else
  PY_VER=$(python3 --version 2>/dev/null || echo "not found")
  if [[ "$DRY_RUN" == true ]]; then
    fail "Python $PY_VER (need 3.9+)"
    fail "Install: brew install python@3.11  or  https://python.org"
  else
    warn "Python $PY_VER — trying to install 3.11 via brew..."
    command -v brew &>/dev/null && brew install python@3.11 || \
      die "Python 3.9+ required" "Install from https://python.org or run: brew install python@3.11"
  fi
  ok "Python $(python3 --version)"
fi

# ─── STEP 3: npm install ─────────────────────────────────────────────────────
step 3 "Node dependencies (npm install)"
cd "$ROOT"
if [[ "$DRY_RUN" == true ]]; then
  [[ -f package.json ]] && ok "package.json found" || fail "package.json missing"
  [[ -d node_modules ]] && ok "node_modules exists" || warn "node_modules missing (run npm install)"
else
  echo -e "  Installing Node packages..."
  npm install --prefer-offline 2>&1 | tail -3 || \
    npm install 2>&1 | tail -3 || \
    die "npm install failed" "Check your internet connection or run: cd $ROOT && npm install"
  ok "Node dependencies installed"
fi

# ─── STEP 4: Python dependencies ─────────────────────────────────────────────
step 4 "Python dependencies (pip)"
if [[ "$DRY_RUN" == true ]]; then
  python3 -c "import pyautogui" 2>/dev/null && ok "pyautogui" || warn "pyautogui not installed"
  python3 -c "import aiohttp" 2>/dev/null && ok "aiohttp" || warn "aiohttp not installed"
else
  echo -e "  Installing Python packages..."
  python3 -m pip install -r "$ROOT/requirements.txt" -q --no-warn-script-location 2>&1 | tail -2 || \
    die "pip install failed" "Try: python3 -m pip install -r requirements.txt --user"
  ok "Python dependencies installed"
fi

# ─── STEP 5: Ollama ──────────────────────────────────────────────────────────
step 5 "Ollama"
if command -v ollama &>/dev/null; then
  ok "Ollama $(ollama --version 2>/dev/null | head -1)"
else
  if [[ "$DRY_RUN" == true ]]; then
    fail "Ollama not found"
    fail "Install: curl -fsSL https://ollama.ai/install.sh | sh"
  else
    warn "Ollama not found — installing..."
    curl -fsSL https://ollama.ai/install.sh | sh || \
      die "Ollama installation failed" "Install manually: https://ollama.com/download"
    ok "Ollama installed"
  fi
fi

# ─── STEP 6: Ollama models ───────────────────────────────────────────────────
step 6 "Ollama models (minimal: llama3.2:3b)"
if [[ "$NO_MODELS" == true ]]; then
  warn "Skipped (--no-models)"
elif [[ "$DRY_RUN" == true ]]; then
  if ollama list 2>/dev/null | grep -q "llama3.2"; then
    ok "llama3.2 model found"
  else
    warn "llama3.2:3b not pulled yet (run: ollama pull llama3.2:3b)"
  fi
else
  # Pull minimal model first (1.9GB), vision model is optional
  echo -e "  Pulling llama3.2:3b (required, ~1.9GB)..."
  ollama pull llama3.2:3b || die "Failed to pull llama3.2:3b" "Run manually: ollama pull llama3.2:3b"
  ok "llama3.2:3b ready"

  # Pull vision model in background — non-blocking
  echo -e "  Pulling llava:7b in background (optional vision, ~4GB)..."
  ollama pull llava:7b &>/dev/null &
  warn "llava:7b pulling in background (for vision features)"
fi

# ─── STEP 7: .env setup ──────────────────────────────────────────────────────
step 7 ".env configuration"
if [[ -f "$ROOT/.env" ]]; then
  ok ".env already exists"
  # Check critical keys
  if grep -q "your_telegram_bot_token" "$ROOT/.env"; then
    warn "TELEGRAM_BOT_TOKEN not configured yet"
    warn "Edit .env and set your token from @BotFather"
  else
    ok "TELEGRAM_BOT_TOKEN configured"
  fi
  if grep -q "your_telegram_user_id\|000000000" "$ROOT/.env"; then
    warn "ADMIN_TELEGRAM_ID not configured yet"
    warn "Get your ID from @userinfobot on Telegram"
  else
    ok "ADMIN_TELEGRAM_ID configured"
  fi
else
  if [[ "$DRY_RUN" == true ]]; then
    warn ".env missing — will be created from .env.example"
  else
    cp "$ROOT/.env.example" "$ROOT/.env"
    # Fix WORKSPACE_ROOT to current directory
    sed -i.bak "s|WORKSPACE_ROOT=.*|WORKSPACE_ROOT=$ROOT|g" "$ROOT/.env" && rm -f "$ROOT/.env.bak"
    ok ".env created from .env.example"
    echo ""
    echo -e "  ${YELLOW}${BOLD}ACTION REQUIRED — Edit .env:${RESET}"
    echo -e "  1. ${BOLD}TELEGRAM_BOT_TOKEN${RESET} — from @BotFather on Telegram"
    echo -e "  2. ${BOLD}ADMIN_TELEGRAM_ID${RESET}  — from @userinfobot on Telegram"
    echo -e "  File: ${BLUE}$ROOT/.env${RESET}"
  fi
fi

# ─── STEP 7b: TypeScript build (génère dist/ pour agentLoop + provider) ───────────────
step "7b" "Compilation TypeScript (agentLoop, provider, toolRouter)"
if [[ "$DRY_RUN" == true ]]; then
  ok "Skipped in dry-run"
else
  if command -v npx >/dev/null 2>&1; then
    if npx tsc --outDir dist/ --skipLibCheck 2>/dev/null; then
      ok "TypeScript compilé → dist/"
    else
      warn "TypeScript: erreurs de compilation (non bloquant — agentBridge utilise le fallback stub)"
    fi
  else
    warn "npx introuvable — compilation TypeScript ignorée"
  fi
fi

# ─── STEP 8: Smoke test ───────────────────────────────────────────────────────
step 8 "Smoke test"
if [[ "$DRY_RUN" == true ]]; then
  ok "Skipped in dry-run"
elif node "$ROOT/bin/laruche.js" doctor --quiet 2>/dev/null; then
  ok "laruche doctor passed"
else
  warn "laruche doctor found issues — run 'laruche doctor' for details"
fi

# ─── Summary ─────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}═══════════════════════════════════════${RESET}"
if [[ "$DRY_RUN" == true ]]; then
  echo -e "${BOLD}  Dry-run complete. Check warnings above.${RESET}"
else
  echo -e "${GREEN}${BOLD}  🐝 LaRuche installation complete!${RESET}"
  echo ""
  echo -e "  Next steps:"
  echo -e "    ${BOLD}1.${RESET} Edit .env → set TELEGRAM_BOT_TOKEN + ADMIN_TELEGRAM_ID"
  echo -e "    ${BOLD}2.${RESET} ${BLUE}laruche start${RESET}    ← launch the swarm"
  echo -e "    ${BOLD}3.${RESET} Send ${BLUE}/start${RESET} to your Telegram bot"
  echo ""
  echo -e "  Dashboard: ${BLUE}http://localhost:8080${RESET}"
  echo -e "  Docs:      ${BLUE}docs/INTEGRATION.md${RESET}"
fi
echo -e "${GREEN}${BOLD}═══════════════════════════════════════${RESET}"
echo ""
