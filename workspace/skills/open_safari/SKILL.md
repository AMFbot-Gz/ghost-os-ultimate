---
name: open_safari
version: 1.0.0
description: Ouvre Safari sur macOS et lui donne le focus. Utilisé comme première étape de toute navigation web.
tags: [browser, safari, macos, navigation, operator]
scope: global
agents: [operator, planner]
tools:
  - os.openApp
risk: low
cost: low
requires_hitl: false
---

# Skill: Open Safari

Ouvre l'application Safari sur macOS. C'est la première étape nécessaire avant toute navigation web.

## Comportement

Utilise `os.openApp` avec `app: "Safari"`. L'action attend automatiquement 1.5s que Safari soit prêt avant de rendre la main.

## Steps

1. Appelle `os.openApp({ app: "Safari" })`
2. Vérifie que le résultat contient `success: true`
3. Si échec, tente `os.focusApp({ app: "Safari" })` (app peut-être déjà ouverte)

## Params attendus

Aucun paramètre requis.

## Résultat

```json
{ "success": true, "app": "Safari", "message": "Safari ouvert" }
```

## Notes

- Safari doit être installé (natif macOS)
- Si Google Chrome est préféré, remplacer "Safari" par "Google Chrome"
- Délai de 1.5s après l'ouverture — suffisant pour la plupart des Macs
