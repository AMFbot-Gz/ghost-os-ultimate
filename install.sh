#!/usr/bin/env bash
# install.sh — Installateur universel Jarvis v2.0
#
# Usage :
#   curl -fsSL https://raw.githubusercontent.com/wiaamhadara/ghost-os-ultimate/main/install.sh | bash
#   # ou en local :
#   bash install.sh
#
# Plateformes supportées :
#   macOS ARM64  (Apple Silicon M1/M2/M3)
#   macOS x86_64 (Intel Mac)
#   Linux x86_64 (Ubuntu 20+, Debian 11+)
#
# Ce script :
#   1. Vérifie les prérequis (git, node, npm, python3, pm2)
#   2. Clone ou met à jour le dépôt ghost-os-ultimate
#   3. Installe les dépendances npm
#   4. Télécharge le binaire PicoClaw si absent
#   5. Crée les répertoires de logs
#   6. Initialise le .env si absent (mode non-interactif)
#   7. Installe le CLI `jarvis` dans /usr/local/bin
#   8. Lance le wizard de configuration
#   9. Démarre Jarvis via PM2
#  10. Affiche le récapitulatif

set -euo pipefail

# ── Variables ──────────────────────────────────────────────────────────────────
REPO_URL="${JARVIS_REPO:-https://github.com/wiaamhadara/ghost-os-ultimate.git}"
INSTALL_DIR="${JARVIS_DIR:-$HOME/ghost-os-ultimate}"
PICOCLAW_VERSION="v0.2.3"
PICOCLAW_DIR="$INSTALL_DIR/satellite"
NODE_MIN_VERSION=18
PM2_VERSION="latest"

# ── Couleurs ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

ok()    { echo -e "${GREEN}✅ $*${RESET}"; }
err()   { echo -e "${RED}❌ $*${RESET}" >&2; }
info()  { echo -e "${CYAN}ℹ  $*${RESET}"; }
warn()  { echo -e "${YELLOW}⚠  $*${RESET}"; }
step()  { echo -e "\n${BOLD}${CYAN}── $* ${RESET}"; }
sep()   { echo -e "${BOLD}────────────────────────────────────────────────────${RESET}"; }
die()   { err "$*"; exit 1; }

# ── Détection plateforme ─────────────────────────────────────────────────────
detect_platform() {
  OS="$(uname -s)"
  ARCH="$(uname -m)"

  case "$OS" in
    Darwin)
      case "$ARCH" in
        arm64)  PLATFORM="darwin_arm64"  ;;
        x86_64) PLATFORM="darwin_amd64"  ;;
        *)      die "Architecture macOS non supportée : $ARCH" ;;
      esac
      ;;
    Linux)
      case "$ARCH" in
        x86_64) PLATFORM="linux_amd64"   ;;
        aarch64|arm64) PLATFORM="linux_arm64" ;;
        *)      die "Architecture Linux non supportée : $ARCH" ;;
      esac
      ;;
    *)
      die "Système non supporté : $OS. Jarvis supporte macOS et Linux."
      ;;
  esac
  info "Plateforme détectée : $OS $ARCH ($PLATFORM)"
}

# ── Étape 1 : Prérequis ───────────────────────────────────────────────────────
check_prerequisites() {
  step "1/10 Vérification des prérequis"

  # git
  command -v git &>/dev/null || die "git non trouvé — installez git puis relancez."
  ok "git $(git --version | awk '{print $3}')"

  # node
  command -v node &>/dev/null || die "Node.js non trouvé — installez Node.js ${NODE_MIN_VERSION}+ depuis https://nodejs.org"
  NODE_VER=$(node --version | sed 's/v//' | cut -d. -f1)
  if [ "$NODE_VER" -lt "$NODE_MIN_VERSION" ]; then
    die "Node.js ${NODE_MIN_VERSION}+ requis (actuel : v${NODE_VER})"
  fi
  ok "Node.js $(node --version)"

  # npm
  command -v npm &>/dev/null || die "npm non trouvé (devrait être bundlé avec Node.js)"
  ok "npm $(npm --version)"

  # python3 (optionnel mais recommandé pour les agents)
  if command -v python3 &>/dev/null; then
    ok "Python3 $(python3 --version | awk '{print $2}')"
  else
    warn "Python3 non trouvé — les agents Python ne démarreront pas."
  fi

  # curl
  command -v curl &>/dev/null || die "curl non trouvé — requis pour télécharger PicoClaw"
  ok "curl disponible"
}

# ── Étape 2 : PM2 ─────────────────────────────────────────────────────────────
install_pm2() {
  step "2/10 PM2"
  if command -v pm2 &>/dev/null; then
    ok "PM2 $(pm2 --version) déjà installé"
  else
    info "Installation de PM2..."
    npm install -g "pm2@${PM2_VERSION}" --quiet
    ok "PM2 installé"
  fi
}

# ── Étape 3 : Clone / mise à jour ────────────────────────────────────────────
clone_or_update() {
  step "3/10 Dépôt ghost-os-ultimate"
  if [ -d "$INSTALL_DIR/.git" ]; then
    info "Dépôt existant trouvé — mise à jour..."
    cd "$INSTALL_DIR"
    git pull --ff-only --quiet || warn "git pull échoué — continuons avec la version locale"
    ok "Dépôt mis à jour : $INSTALL_DIR"
  elif [ -d "$INSTALL_DIR" ] && [ -f "$INSTALL_DIR/package.json" ]; then
    # Installation locale (répertoire courant sans .git)
    info "Répertoire existant sans .git — utilisation tel quel"
    ok "Répertoire : $INSTALL_DIR"
  else
    info "Clonage dans $INSTALL_DIR..."
    git clone --depth=1 "$REPO_URL" "$INSTALL_DIR"
    ok "Dépôt cloné"
  fi
}

# ── Étape 4 : npm install ─────────────────────────────────────────────────────
install_deps() {
  step "4/10 Dépendances npm"
  cd "$INSTALL_DIR"
  npm install --silent --no-fund --no-audit
  ok "Dépendances installées"
}

# ── Étape 5 : PicoClaw ────────────────────────────────────────────────────────
install_picoclaw() {
  step "5/10 PicoClaw satellite"
  mkdir -p "$PICOCLAW_DIR"

  local binary="$PICOCLAW_DIR/picoclaw"
  if [ -f "$binary" ] && [ -x "$binary" ]; then
    ok "PicoClaw déjà présent : $binary"
    return 0
  fi

  # Construire l'URL de téléchargement
  local fname=""
  case "$PLATFORM" in
    darwin_arm64)  fname="picoclaw_Darwin_arm64.tar.gz"  ;;
    darwin_amd64)  fname="picoclaw_Darwin_x86_64.tar.gz" ;;
    linux_amd64)   fname="picoclaw_Linux_x86_64.tar.gz"  ;;
    linux_arm64)   fname="picoclaw_Linux_arm64.tar.gz"   ;;
  esac

  local url="https://github.com/sipeed/picoclaw/releases/download/${PICOCLAW_VERSION}/${fname}"
  info "Téléchargement PicoClaw $PICOCLAW_VERSION ($fname)..."

  local tmp
  tmp="$(mktemp)"
  if curl -fsSL --max-time 60 "$url" -o "$tmp" 2>/dev/null; then
    tar -xzf "$tmp" -C "$PICOCLAW_DIR" --strip-components=0 2>/dev/null || true
    rm -f "$tmp"
    # Chercher le binaire dans le dossier extrait
    local found
    found="$(find "$PICOCLAW_DIR" -name 'picoclaw' -type f 2>/dev/null | head -1)"
    if [ -n "$found" ]; then
      mv "$found" "$binary" 2>/dev/null || true
      chmod +x "$binary"
      ok "PicoClaw installé : $binary"
    else
      warn "Binaire PicoClaw non trouvé dans l'archive — satellite désactivé"
    fi
  else
    rm -f "$tmp"
    warn "Impossible de télécharger PicoClaw (réseau ?) — satellite désactivé"
    warn "Pour installer manuellement :"
    warn "  curl -fsSL $url | tar -xz -C $PICOCLAW_DIR/"
  fi
}

# ── Étape 6 : Répertoires de logs ─────────────────────────────────────────────
create_directories() {
  step "6/10 Répertoires"
  mkdir -p \
    "$INSTALL_DIR/.laruche/logs" \
    "$INSTALL_DIR/agent/logs" \
    "$INSTALL_DIR/satellite"
  ok "Répertoires créés"
}

# ── Étape 7 : .env initial ────────────────────────────────────────────────────
init_env() {
  step "7/10 Configuration .env"
  local env_file="$INSTALL_DIR/.env"

  if [ -f "$env_file" ]; then
    ok ".env existant conservé"
    return 0
  fi

  info "Création d'un .env minimal (à compléter avec 'jarvis setup')..."
  cat > "$env_file" <<'ENVEOF'
# Jarvis v2.0 — Configuration minimale
# Complétez avec : jarvis setup

STANDALONE_MODE=true
GHOST_OS_MODE=ultimate
NODE_ENV=production
OLLAMA_HOST=http://localhost:11434
OLLAMA_MODEL=llama3.2:3b
API_PORT=3002
PICOCLAW_PORT=8090
HITL_TIMEOUT_SECONDS=120

# À remplir obligatoirement :
TELEGRAM_BOT_TOKEN=
ADMIN_TELEGRAM_ID=
CHIMERA_SECRET=
ENVEOF
  ok ".env minimal créé : $env_file"
  warn "Complétez votre configuration avec : jarvis setup"
}

# ── Étape 8 : Symlink CLI ─────────────────────────────────────────────────────
install_cli() {
  step "8/10 CLI jarvis"
  local bin_src="$INSTALL_DIR/bin/jarvis"
  local bin_dst="/usr/local/bin/jarvis"

  chmod +x "$bin_src"

  if [ -L "$bin_dst" ] || [ -f "$bin_dst" ]; then
    info "Symlink existant — mise à jour..."
    sudo ln -sf "$bin_src" "$bin_dst" 2>/dev/null || {
      warn "sudo nécessaire pour /usr/local/bin — ajout dans ~/.local/bin à la place"
      mkdir -p "$HOME/.local/bin"
      ln -sf "$bin_src" "$HOME/.local/bin/jarvis"
      info "Ajoutez ~/.local/bin à votre PATH si nécessaire"
    }
  else
    sudo ln -sf "$bin_src" "$bin_dst" 2>/dev/null || {
      warn "sudo non disponible — ajout dans ~/.local/bin"
      mkdir -p "$HOME/.local/bin"
      ln -sf "$bin_src" "$HOME/.local/bin/jarvis"
    }
  fi
  ok "CLI 'jarvis' disponible"
}

# ── Étape 9 : PM2 startup ─────────────────────────────────────────────────────
setup_pm2_startup() {
  step "9/10 PM2 startup (redémarrage automatique)"
  if [ "${CI:-}" = "true" ] || [ "${JARVIS_NO_STARTUP:-}" = "1" ]; then
    info "Mode CI — pm2 startup ignoré"
    return 0
  fi
  pm2 startup 2>/dev/null | grep "sudo" | bash 2>/dev/null || \
    warn "pm2 startup requiert sudo — lancez manuellement : pm2 startup"
  ok "PM2 startup configuré"
}

# ── Étape 10 : Démarrage ──────────────────────────────────────────────────────
start_jarvis() {
  step "10/10 Démarrage Jarvis"
  cd "$INSTALL_DIR"

  # Ne démarrer que si TELEGRAM_BOT_TOKEN est rempli
  local token
  token="$(grep -E '^TELEGRAM_BOT_TOKEN=.+' "$INSTALL_DIR/.env" 2>/dev/null | cut -d= -f2 || true)"

  if [ -z "$token" ]; then
    warn "TELEGRAM_BOT_TOKEN vide — Jarvis ne sera pas démarré automatiquement."
    info "Complétez la configuration puis : jarvis start"
    return 0
  fi

  pm2 start "$INSTALL_DIR/ecosystem.config.cjs" --env production 2>/dev/null
  pm2 save
  ok "Jarvis démarré"
}

# ── Récapitulatif ─────────────────────────────────────────────────────────────
print_summary() {
  sep
  echo -e "${BOLD}  Jarvis v2.0 — Installation terminée !${RESET}"
  sep
  echo ""
  echo -e "  Répertoire   : ${CYAN}$INSTALL_DIR${RESET}"
  echo -e "  CLI          : ${CYAN}jarvis <commande>${RESET}"
  echo ""
  echo -e "  ${BOLD}Prochaines étapes :${RESET}"
  echo -e "  1. Configurez votre bot : ${CYAN}jarvis setup${RESET}"
  echo -e "  2. Démarrez Jarvis      : ${CYAN}jarvis start${RESET}"
  echo -e "  3. Vérifiez l'état      : ${CYAN}jarvis status${RESET}"
  echo ""
  echo -e "  ${BOLD}Commandes utiles :${RESET}"
  echo -e "    jarvis skills      — Liste les 40+ skills"
  echo -e "    jarvis logs        — Logs en temps réel"
  echo -e "    jarvis update      — Mise à jour Jarvis"
  echo ""
  sep
}

# ── Point d'entrée ────────────────────────────────────────────────────────────
main() {
  echo ""
  echo -e "${BOLD}${CYAN}  Jarvis v2.0 — Installateur universel${RESET}"
  echo -e "  Agent IA autonome 100% local"
  sep
  echo ""

  detect_platform
  check_prerequisites
  install_pm2
  clone_or_update
  install_deps
  install_picoclaw
  create_directories
  init_env
  install_cli
  setup_pm2_startup
  start_jarvis
  print_summary
}

main "$@"
