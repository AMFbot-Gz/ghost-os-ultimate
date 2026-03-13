---
name: google_search
version: 1.0.0
description: Effectue une recherche Google et extrait les premiers résultats. Utilise Playwright.
tags: [google, search, web, research, operator]
scope: global
agents: [operator, devops, planner]
tools:
  - pw.goto
  - pw.extract
risk: low
cost: low
requires_hitl: false
params:
  query: { type: string, required: true }
  limit: { type: number, default: 5 }
---

# Skill: Google Search

Recherche sur Google et retourne les titres + URLs des premiers résultats.

## Steps

1. `pw.goto("https://www.google.com/search?q=<query>")`
2. `pw.extract("h3")` — titres des résultats
3. `pw.extract("cite")` — URLs
4. Retourner liste structurée
