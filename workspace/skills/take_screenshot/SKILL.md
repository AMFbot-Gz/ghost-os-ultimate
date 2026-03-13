---
name: take_screenshot
version: 1.0.0
description: Prend une capture d'écran de l'écran complet ou d'une région et la sauvegarde.
tags: [screenshot, vision, capture, operator]
scope: global
agents: [operator, planner]
tools:
  - pw.screenshot
risk: low
cost: low
requires_hitl: false
---

# Skill: Take Screenshot

Capture l'écran actuel via Playwright ou PyAutoGUI.
