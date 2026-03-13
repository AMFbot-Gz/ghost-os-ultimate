---
name: run_code
version: 1.0.0
description: Exécute du code Python ou JavaScript dans le terminal et retourne le résultat.
tags: [code, execute, terminal, devops, builder]
scope: global
agents: [devops, builder, planner]
tools:
  - terminal.safe
risk: medium
cost: low
requires_hitl: false
params:
  code: { type: string, required: true }
  language: { type: string, default: "python" }
---

# Skill: Run Code

Exécute du code dans le terminal et capture la sortie.

## Steps

1. Détecter le langage (python/javascript/bash)
2. Écrire le code dans un fichier temporaire
3. Exécuter via `python3 /tmp/code.py` ou `node /tmp/code.js`
4. Capturer stdout + stderr
5. Retourner le résultat

## Sécurité

Utilise `terminal.safe` — pas d'accès root, pas de commandes dangereuses.
