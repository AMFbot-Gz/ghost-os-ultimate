---
name: go_to_youtube
version: 1.0.0
description: Navigue vers YouTube (youtube.com) dans Safari. Utilisé après open_safari pour accéder à YouTube.
tags: [browser, youtube, navigation, safari, operator]
scope: global
agents: [operator, planner]
tools:
  - browser.goto
risk: low
cost: low
requires_hitl: false
---

# Skill: Go to YouTube

Navigue vers la page d'accueil de YouTube dans Safari.

## Comportement

Utilise `browser.goto` avec `url: "https://www.youtube.com"`. Safari doit être ouvert au préalable (skill `open_safari`).

## Steps

1. Appelle `browser.goto({ url: "https://www.youtube.com" })`
2. Attend 2.5s le chargement
3. Si échec, tente avec l'URL alternative `https://youtube.com`

## Params attendus

Aucun paramètre requis. L'URL est fixe : `https://www.youtube.com`.

## Résultat

```json
{ "success": true, "url": "https://www.youtube.com" }
```

## Notes

- Requiert Safari ouvert (exécuter `open_safari` avant)
- La page peut prendre 2-5s à charger selon la connexion
- Si la page est déjà sur YouTube, ce skill navigue quand même vers la home
