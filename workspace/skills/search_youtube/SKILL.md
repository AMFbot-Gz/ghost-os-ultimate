---
name: search_youtube
version: 1.0.0
description: Effectue une recherche sur YouTube avec une requête textuelle. Navigue directement vers les résultats de recherche.
tags: [youtube, search, browser, operator, music]
scope: global
agents: [operator, planner]
tools:
  - browser.searchYouTube
risk: low
cost: low
requires_hitl: false
params:
  query:
    type: string
    required: true
    default: "music playlist"
    description: Termes de recherche YouTube
---

# Skill: Search YouTube

Lance une recherche YouTube avec une requête textuelle. Utilise l'URL de recherche directe pour éviter les interactions avec l'interface.

## Comportement

Construit l'URL `https://www.youtube.com/results?search_query=<query>` et navigue directement. Plus fiable que de taper dans la barre de recherche.

## Steps

1. Appelle `browser.searchYouTube({ query: params.query })`
2. Attend 3s le chargement des résultats
3. Vérifie que la page a chargé

## Params

| Paramètre | Type | Requis | Défaut | Description |
|-----------|------|--------|--------|-------------|
| `query` | string | oui | "music playlist" | Termes de recherche |

## Exemples de query

- Pour de la musique relaxante: `"chill lofi playlist"`
- Pour du jazz: `"jazz playlist 2024"`
- Pour une chanson spécifique: `"bohemian rhapsody queen"`
- Défaut si pas précisé par l'utilisateur: `"relaxing music playlist"`

## Résultat

```json
{ "success": true, "query": "chill lofi playlist", "url": "https://..." }
```

## Notes

- Pas besoin de naviguer vers YouTube avant (la macro `searchYouTube` le fait)
- Le paramètre `query` est toujours renseigné par le planner — ne jamais laisser vide
- Si l'utilisateur dit juste "mets de la musique", utiliser `"relaxing music playlist"` comme défaut
