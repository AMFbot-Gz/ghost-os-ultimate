---
name: run_command
description: Exécute une commande shell sûre (ls, cat, git, npm, node, python3, curl)
version: 1.0.0
tags: [terminal, devops, shell]
---

# run_command

Exécute une commande shell avec liste blanche de commandes autorisées.

## Params

- `command` (string, requis) : commande à exécuter
- `cwd` (string, optionnel) : répertoire de travail
- `timeout` (number, optionnel) : timeout en ms. Défaut: 10000
