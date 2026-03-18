#!/bin/bash
# scripts/start-agents.sh — Lance tous les agents Python
cd "$(dirname "$0")/.."
echo "[Agents] Démarrage des 16 agents Python..."
exec python3 start_agent.py
