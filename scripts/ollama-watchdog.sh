#!/bin/bash
# scripts/ollama-watchdog.sh — Vérifie ollama serve toutes les 60s
# PM2 le redémarre automatiquement si crash
while true; do
  if ! curl -s --max-time 3 http://localhost:11434/api/tags > /dev/null 2>&1; then
    echo "[$(date)] Ollama DOWN — tentative de restart..."
    ollama serve &>/tmp/ollama-restart.log &
    sleep 10
    if curl -s --max-time 3 http://localhost:11434/api/tags > /dev/null 2>&1; then
      echo "[$(date)] Ollama relancé avec succès"
    else
      echo "[$(date)] Ollama restart échoué"
    fi
  else
    echo "[$(date)] Ollama OK"
  fi
  sleep 60
done
