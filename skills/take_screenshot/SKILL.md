---
name: take_screenshot
description: Prend une capture d'écran de l'écran macOS et retourne le chemin
version: 1.0.0
tags: [vision, screenshot, macos]
---

# take_screenshot

Prend une capture d'écran via `screencapture -x` et retourne le chemin du fichier.

## Params

- `path` (string, optionnel) : chemin de destination. Défaut: `/tmp/laruche_screenshot.png`
