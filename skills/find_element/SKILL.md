---
name: find_element
description: Trouve un élément UI par description sémantique (ex:"bouton Envoyer", "champ recherche") via l'arbre AX macOS — sans coordonnées fixes
version: 1.0.0
tags: [accessibility, semantic, ui, computer-use, find, element]
---

# find_element

Recherche sémantique d'éléments UI dans l'app de premier plan.
Utilise l'API Accessibility macOS (AX tree) pour trouver n'importe quel élément par description textuelle.

## Params

- `query` (string, requis) : description de l'élément ex: "bouton Envoyer", "champ recherche", "fermer"
- `app` (string, optionnel) : app cible
- `threshold` (float, optionnel) : seuil de confiance 0.0-1.0. Défaut: 0.3

## Retour

```json
{ "found": true, "title": "Envoyer", "role": "button", "x": 460, "y": 380, "confidence": 0.9 }
```
