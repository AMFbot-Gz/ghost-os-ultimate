---
name: send_email
version: 1.0.0
description: Ouvre Gmail dans le navigateur, compose et envoie un email. Fonctionne via Playwright.
tags: [email, gmail, communication, operator]
scope: global
agents: [operator, planner]
tools:
  - pw.goto
  - pw.click
  - pw.fill
  - pw.press
risk: medium
cost: medium
requires_hitl: true
params:
  to: { type: string, required: true }
  subject: { type: string, required: true }
  body: { type: string, required: true }
---

# Skill: Send Email

Compose et envoie un email via Gmail dans le navigateur.

## Steps

1. `pw.goto("https://mail.google.com/mail/u/0/#compose")`
2. Attendre que le formulaire de composition apparaisse
3. `pw.fill("[name='to']", params.to)` ou équivalent
4. `pw.fill("[name='subjectbox']", params.subject)`
5. `pw.fill("[role='textbox'][aria-label*='message']", params.body)`
6. `pw.click("[data-tooltip='Send']")`
7. Vérifier confirmation

## HITL

Ce skill requiert validation humaine avant envoi (requires_hitl: true).
