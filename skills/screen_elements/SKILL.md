---
name: screen_elements
description: Analyse sémantique complète de l'écran — retourne tous les éléments UI interactifs, les apps en cours, la résolution et une vue structurée par rôle
version: 1.0.0
tags: [accessibility, semantic, screen, computer-use, ui, perception]
---

# screen_elements

Vue d'ensemble sémantique de l'écran actuel. Combine :
- AX tree de l'app de premier plan
- Infos système (résolution, apps actives)
- Groupement par rôle (buttons, text_fields, etc.)

## Params

- `app` (string, optionnel) : app à analyser. Défaut: app de premier plan

## Retour

```json
{
  "success": true,
  "frontmost_app": "Safari",
  "elements_count": 12,
  "elements_by_role": { "button": ["Envoyer", "Annuler"], "text_field": ["Recherche"] },
  "interactive": [...]
}
```
