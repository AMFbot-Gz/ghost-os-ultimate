---
name: wait_for_element
description: Attend qu'un élément UI apparaisse sur l'écran (polling AX tree) avec timeout configurable — utile après navigation ou chargement
version: 1.0.0
tags: [accessibility, semantic, wait, computer-use, ui, synchronization]
---

# wait_for_element

Interroge l'arbre AX à intervalles réguliers jusqu'à ce que l'élément recherché apparaisse ou que le timeout expire.

## Params

- `query` (string, requis) : description de l'élément attendu
- `timeout` (float, optionnel) : secondes max d'attente. Défaut: 10.0
- `interval` (float, optionnel) : intervalle de polling en secondes. Défaut: 0.5
- `app` (string, optionnel) : app cible

## Retour

```json
{ "success": true, "found": true, "element": {...}, "elapsed": 1.5 }
```
