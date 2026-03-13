---
name: play_first_result
version: 1.0.0
description: Clique sur le premier résultat vidéo YouTube pour lancer la lecture. À utiliser après search_youtube.
tags: [youtube, play, click, video, music, operator]
scope: global
agents: [operator, planner]
tools:
  - browser.clickFirstYoutubeResult
risk: low
cost: low
requires_hitl: false
---

# Skill: Play First YouTube Result

Clique sur le premier résultat vidéo de la page de résultats YouTube.

## Comportement

Utilise une approche hybride:
1. **Méthode DOM** (prioritaire) : exécute JavaScript dans Safari pour trouver et cliquer sur le premier lien `ytd-video-renderer`. Plus fiable car sémantiquement correct.
2. **Fallback heuristique** : si le DOM ne répond pas, clique à la position (~35% x, ~38% y) de la fenêtre Safari où se trouve typiquement le premier résultat.

## Steps

1. Vérifie que Safari est en premier plan (la page de résultats doit être chargée)
2. Appelle `browser.clickFirstYoutubeResult({})`
3. Attend 2s pour que la vidéo commence
4. Considère le skill terminé — la vidéo est en lecture

## Params attendus

Aucun paramètre requis. Clique toujours sur le premier résultat.

## Résultat

```json
{ "success": true, "method": "dom_click", "url": "https://youtube.com/watch?v=..." }
```
ou
```json
{ "success": true, "method": "heuristic_click", "x": 700, "y": 380 }
```

## Gestion d'erreur

Si le clic échoue:
- Attendre 1s et réessayer une fois
- Si encore échec, signaler `success: false` avec le détail de l'erreur

## Notes

- Ce skill suppose que la page de résultats YouTube est déjà chargée
- La méthode DOM nécessite que JavaScript soit activé dans Safari (par défaut)
- Le heuristic fallback dépend de la taille de la fenêtre — calibré pour fenêtre ≥ 1000px de large
