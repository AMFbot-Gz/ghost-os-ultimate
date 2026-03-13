---
name: smart_click
description: Clique sur un élément UI par description sémantique (ex:"cliquer sur Envoyer") — trouve l'élément dans l'arbre AX puis clique sans coordonnées fixes
version: 1.0.0
tags: [accessibility, semantic, click, computer-use, ui, interaction]
---

# smart_click

Clic sémantique : trouve un élément UI par description et clique dessus automatiquement.
Combine find_element (AX tree) + pyautogui click.

## Params

- `query` (string, requis) : description de l'élément à cliquer ex: "bouton Envoyer", "Fermer", "champ URL"
- `app` (string, optionnel) : app cible
- `double` (bool, optionnel) : double-clic. Défaut: false

## Retour

```json
{ "success": true, "clicked": "Envoyer", "role": "button", "x": 460, "y": 380, "confidence": 0.9 }
```
