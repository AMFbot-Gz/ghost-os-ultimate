---
name: close_app
version: 1.0.0
description: Ferme une application macOS proprement via AppleScript.
tags: [close, app, macos, operator]
scope: global
agents: [operator, planner]
tools:
  - os.focusApp
risk: low
cost: low
requires_hitl: false
params:
  app: { type: string, required: true }
---

# Skill: Close App

Ferme une application macOS proprement.

## Steps

1. Cibler l'application par nom
2. Envoyer la commande quit via AppleScript
