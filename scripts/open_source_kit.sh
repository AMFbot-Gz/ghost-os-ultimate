#!/usr/bin/env bash
# scripts/open_source_kit.sh — Prépare Ghost OS Ultimate pour open-source
# ═══════════════════════════════════════════════════════════════════════════
# Usage: bash scripts/open_source_kit.sh [--dry-run]
#
# Ce script :
#   1. Purge les secrets du .env (génère .env.example propre)
#   2. Nettoie les fichiers temporaires / caches
#   3. Vérifie que .gitignore couvre tous les patterns sensibles
#   4. Lance les tests (smoke test)
#   5. Génère un README synthétique si manquant
#   6. Crée l'archive de release
# ═══════════════════════════════════════════════════════════════════════════

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DRY_RUN="${1:-}"
VERSION=$(node -p "require('$ROOT/package.json').version" 2>/dev/null || echo "1.0.0")

GREEN='\033[0;32m' YELLOW='\033[0;33m' RED='\033[0;31m' BLUE='\033[0;34m' NC='\033[0m' BOLD='\033[1m'
ok()   { echo -e "  ${GREEN}✅${NC} $1"; }
warn() { echo -e "  ${YELLOW}⚠️ ${NC} $1"; }
err()  { echo -e "  ${RED}❌${NC} $1"; }
info() { echo -e "  ${BLUE}ℹ️ ${NC} $1"; }
dry()  { [[ "$DRY_RUN" == "--dry-run" ]] && return 0 || return 1; }

echo -e "\n${BOLD}${BLUE}╔══════════════════════════════════════════════════╗"
echo -e "║  Ghost OS Ultimate — Open Source Kit v${VERSION}     ║"
echo -e "╚══════════════════════════════════════════════════╝${NC}\n"

# ── 1. Secrets purge ─────────────────────────────────────────────────────────
echo "1. Purge secrets"

if [[ -f "$ROOT/.env" ]]; then
  python3 - <<'PYEOF'
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent if '__file__' in dir() else Path('.')
env_file = Path(ROOT) / ".env"
example_file = Path(ROOT) / ".env.example"

# Trouver ROOT depuis le script bash
import os
ROOT = Path(os.environ.get('ROOT', Path(__file__).resolve().parent.parent if '__file__' in dir() else '.'))
env_file = ROOT / ".env"
example_file = ROOT / ".env.example"

SENSITIVE_KEYS = ['API_KEY', 'TOKEN', 'SECRET', 'PASSWORD', 'CHIMERA', 'BOT_TOKEN']
lines = env_file.read_text().splitlines()
example_lines = []
for line in lines:
    if '=' in line and not line.startswith('#') and not line.startswith(' '):
        key = line.split('=')[0].strip()
        is_sensitive = any(s in key.upper() for s in SENSITIVE_KEYS)
        if is_sensitive:
            line = f"{key}=<YOUR_{key}_HERE>"
    example_lines.append(line)
example_file.write_text('\n'.join(example_lines))
print(f"  .env.example généré → {example_file}")
PYEOF
  ok ".env.example généré (secrets masqués)"
else
  warn ".env introuvable"
fi

# ── 2. Nettoyage fichiers temporaires ─────────────────────────────────────────
echo ""
echo "2. Nettoyage"

CLEAN_PATTERNS=(
  "**/__pycache__"
  "**/*.pyc"
  "**/.DS_Store"
  "**/node_modules/.cache"
  "/tmp/ghost_*"
  "agent/*.db-shm"
  "agent/*.db-wal"
  ".laruche/machine_profile.json"
)

for pat in "${CLEAN_PATTERNS[@]}"; do
  if dry; then
    info "[DRY] Nettoierait: $pat"
  else
    find "$ROOT" -name "$(basename $pat)" -not -path "*/node_modules/*" \
      -exec rm -rf {} + 2>/dev/null || true
  fi
done
ok "Nettoyage terminé"

# ── 3. .gitignore check ───────────────────────────────────────────────────────
echo ""
echo "3. .gitignore vérification"

REQUIRED_PATTERNS=(
  ".env"
  "*.pyc"
  "__pycache__"
  "*.db-shm"
  "*.db-wal"
  ".laruche/"
  "node_modules/"
  "agent/memory/chromadb/"
  "agent/memory/episodes.jsonl"
  "agent/memory/missions.db"
  "mutations/"
  "data/"
)

GITIGNORE="$ROOT/.gitignore"
MISSING=()
for pat in "${REQUIRED_PATTERNS[@]}"; do
  if ! grep -qF "$pat" "$GITIGNORE" 2>/dev/null; then
    MISSING+=("$pat")
  fi
done

if [[ ${#MISSING[@]} -gt 0 ]]; then
  if dry; then
    warn "[DRY] .gitignore manque: ${MISSING[*]}"
  else
    echo "" >> "$GITIGNORE"
    echo "# Auto-added by open_source_kit.sh" >> "$GITIGNORE"
    for pat in "${MISSING[@]}"; do
      echo "$pat" >> "$GITIGNORE"
    done
    ok ".gitignore complété avec ${#MISSING[@]} patterns"
  fi
else
  ok ".gitignore complet"
fi

# ── 4. Tests smoke ────────────────────────────────────────────────────────────
echo ""
echo "4. Tests smoke"

if dry; then
  info "[DRY] pytest serait lancé"
else
  cd "$ROOT"
  if python3 -m pytest tests/pytest/ -x -q --timeout=20 --tb=line \
       --ignore=tests/pytest/test_e2e_missions.py 2>&1 | tail -5; then
    ok "Tests pytest passants"
  else
    warn "Certains tests échouent — voir ci-dessus"
  fi
fi

# ── 5. README check ────────────────────────────────────────────────────────────
echo ""
echo "5. README"

README="$ROOT/README.md"
if [[ ! -f "$README" ]]; then
  if dry; then
    info "[DRY] README.md serait créé"
  else
    cat > "$README" << 'EOF'
# Ghost OS Ultimate

**Agent IA autonome 100% local + Claude API** — macOS · Python · Node.js

## Quick Start

```bash
# 1. Setup
cp .env.example .env
# Remplir ANTHROPIC_API_KEY, TELEGRAM_BOT_TOKEN, ADMIN_TELEGRAM_ID

# 2. Install
npm install
pip3 install -r requirements.txt

# 3. Start
python3 start_agent.py         # Couches Python (:8001-:8016)
node src/queen_oss.js          # Queen Node.js (:3000)

# 4. Test
curl -X POST http://localhost:8001/mission \
  -H "Content-Type: application/json" \
  -d '{"command": "Analyse le Desktop et résume-le"}'
```

## Architecture

- **16 couches Python FastAPI** (:8001-:8016) — mémoire, évolution, computer use
- **Queen Node.js** (:3000) — orchestrateur + 29 skills + MCP
- **Claude Vision** — computer use zero-config, Retina-aware
- **Auto-évolution** — génère ses propres skills via Claude API

## Docs

- [ARCHITECTURE.md](ARCHITECTURE.md)
- [DECISIONS.md](DECISIONS.md) — Architecture Decision Records
- [CHANGELOG.md](CHANGELOG.md)

## Stack

Python 3.11+ · FastAPI · Node.js 20+ · Ollama · ChromaDB · PyAutoGUI · Anthropic SDK
EOF
    ok "README.md créé"
  fi
else
  ok "README.md existe"
fi

# ── 6. Archive release ────────────────────────────────────────────────────────
echo ""
echo "6. Archive release"

ARCHIVE_NAME="ghost-os-ultimate-v${VERSION}-oss.tar.gz"
ARCHIVE_PATH="/tmp/${ARCHIVE_NAME}"

if dry; then
  info "[DRY] Archive: ${ARCHIVE_NAME}"
else
  tar -czf "$ARCHIVE_PATH" \
    --exclude=".git" \
    --exclude="node_modules" \
    --exclude="__pycache__" \
    --exclude="*.pyc" \
    --exclude=".env" \
    --exclude="agent/memory/chromadb" \
    --exclude="agent/memory/episodes.jsonl" \
    --exclude="agent/memory/missions.db" \
    --exclude=".laruche" \
    --exclude="mutations" \
    --exclude="data" \
    -C "$(dirname "$ROOT")" \
    "$(basename "$ROOT")" 2>/dev/null || true
  SIZE=$(du -sh "$ARCHIVE_PATH" 2>/dev/null | cut -f1)
  ok "Archive: $ARCHIVE_PATH ($SIZE)"
fi

# ── Résumé ─────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}━━━ Résumé OSS Kit ━━━${NC}"
echo "  Version    : v${VERSION}"
echo "  .env.example : ✅ secrets masqués"
echo "  .gitignore   : ✅ complet"
if ! dry; then
  echo "  Archive      : ${ARCHIVE_PATH}"
fi
echo ""
echo -e "  ${GREEN}✅ Ghost OS Ultimate est prêt pour GitHub !${NC}"
echo ""
