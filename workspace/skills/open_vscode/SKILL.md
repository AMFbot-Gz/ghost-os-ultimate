---
name: open_vscode
version: 1.0.0
description: Ouvre Visual Studio Code, optionnellement avec un dossier ou fichier spécifique.
tags: [vscode, code, editor, builder]
scope: global
agents: [builder, devops, planner]
tools:
  - terminal.safe
risk: low
cost: low
requires_hitl: false
params:
  path: { type: string, required: false }
---

# Skill: Open VSCode

Ouvre VSCode via la commande `code` en ligne de commande.

## Steps

1. `terminal.safe("code <path>")`
2. Attendre 2s que VSCode s'ouvre
3. Retourner succès
