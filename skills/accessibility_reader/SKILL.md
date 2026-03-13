---
name: accessibility_reader
description: Lit l'arbre d'accessibilité macOS (AX tree) de l'app active et retourne tous les éléments UI sémantiques avec leurs rôles, labels et positions
version: 1.0.0
tags: [accessibility, macos, semantic, ui, computer-use, ax-tree]
---

# accessibility_reader

Lit l'arbre AX (Accessibility) macOS via System Events pour extraire tous les éléments UI interactifs de l'application de premier plan (ou d'une app spécifiée).

**Open Source** : utilise l'API Accessibility native macOS (AXUIElement) via AppleScript/osascript — zéro dépendances externes.

## Params

- `app` (string, optionnel) : nom de l'app à analyser. Défaut: app de premier plan
- `roles` (array, optionnel) : filtrer par rôle ex: ["button", "text_field"]

## Retour

```json
{
  "app": "Safari",
  "elements": [
    { "role": "button", "title": "Envoyer", "x": 120, "y": 340, "w": 80, "h": 32 },
    { "role": "text_field", "title": "Rechercher", "x": 200, "y": 50, "w": 400, "h": 30 }
  ],
  "elements_count": 2
}
```
