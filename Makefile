# ============================================================
# PICO-RUCHE — Makefile
# Usage : make <cible>
# ============================================================

.PHONY: start stop status test test-python preflight install logs clean help \
        core-only daemon daemon-stub daemon-stop test-adapter machines

# Valeurs par défaut
PYTHON    := python3
LOGS_DIR  := agent/logs
PIDS_DIR  := agent/.pids

# ------------------------------------------------------------
# Cibles principales
# ------------------------------------------------------------

## Démarre l'essaim PICO-RUCHE (7 couches)
start:
	$(PYTHON) start_agent.py

## Arrête proprement tous les services
stop:
	$(PYTHON) stop_agent.py

## Affiche l'état de santé de toutes les couches
status:
	$(PYTHON) scripts/status_agent.py

## Lance les tests Python pytest
test-python:
	$(PYTHON) -m pytest tests/ -v --tb=short

## Lance la suite de tests complète (pytest + Jest unit + intégration)
test: test-python
	npm test

## Vérifie les prérequis (ollama, modèles, .env, dépendances)
preflight:
	bash scripts/phase_check.sh

## Installe les dépendances Python et Node.js
install:
	$(PYTHON) -m pip install -r requirements.txt
	npm install

## Suit les logs en temps réel (toutes les couches)
logs:
	@if ls $(LOGS_DIR)/*.log 1>/dev/null 2>&1; then \
		tail -f $(LOGS_DIR)/*.log; \
	else \
		echo "Aucun log trouvé dans $(LOGS_DIR)/"; \
	fi

## Supprime les PID files et les logs
clean:
	@rm -rf $(PIDS_DIR)
	@if ls $(LOGS_DIR)/*.log 1>/dev/null 2>&1; then \
		rm -f $(LOGS_DIR)/*.log; \
		echo "Logs supprimés."; \
	fi
	@echo "Nettoyage terminé."

# ------------------------------------------------------------
# Multi-machine — Ghost Daemon
# ------------------------------------------------------------

## Lance uniquement le cœur agentique Node.js (sans les couches Python)
core-only:
	STANDALONE_MODE=true GHOST_OS_MODE=ultimate node src/queen_oss.js

## Lance le daemon Ghost sur cette machine (implémentation macOS)
daemon:
	DAEMON_IMPL=macos \
	MACHINE_ID=$${MACHINE_ID:-mac-local} \
	DAEMON_PORT=$${DAEMON_PORT:-9000} \
	node daemon/ghost_daemon.js

## Lance le daemon en mode stub (test / CI sans vrai OS)
daemon-stub:
	DAEMON_IMPL=stub \
	MACHINE_ID=$${MACHINE_ID:-stub-machine} \
	DAEMON_PORT=$${DAEMON_PORT:-9001} \
	node daemon/ghost_daemon.js

## Arrête le daemon Ghost (cherche le process sur DAEMON_PORT)
daemon-stop:
	@lsof -ti:$${DAEMON_PORT:-9000} | xargs kill -9 2>/dev/null && echo "Daemon arrêté." || echo "Aucun daemon trouvé."

## Lance uniquement les tests ComputerUseAdapter
test-adapter:
	npx jest tests/jest/unit/computerUseAdapter.test.js --no-coverage

## Liste les machines connues du Core
machines:
	@curl -s http://localhost:3000/api/machines \
	  -H "Authorization: Bearer $${CHIMERA_SECRET}" | python3 -m json.tool 2>/dev/null || \
	  echo "Ghost Core inaccessible (http://localhost:3000)"

# ------------------------------------------------------------
# Aide
# ------------------------------------------------------------

## Affiche cette aide
help:
	@echo ""
	@echo "🐝 PICO-RUCHE — commandes disponibles"
	@echo "────────────────────────────────────────"
	@grep -E '^##' $(MAKEFILE_LIST) | sed 's/## /  /'
	@echo ""
	@echo "Exemples :"
	@echo "  make preflight   # vérifie ollama + modèles"
	@echo "  make install     # installe les dépendances"
	@echo "  make start       # démarre l'essaim"
	@echo "  make status      # surveille les couches"
	@echo "  make stop        # arrêt propre"
	@echo ""

.DEFAULT_GOAL := help
