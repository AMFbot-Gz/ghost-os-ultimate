---
name: open_app
description: Ouvre une application macOS par son nom (Safari, VSCode, Terminal, Finder, etc.)
version: 1.0.0
tags: [macos, apps, osascript]
---

# open_app

Ouvre une application macOS via AppleScript (`osascript`) avec fallback sur `open -a`.

## Params

- `app` (string, requis) : nom de l'application. Ex: "Safari", "Terminal", "Visual Studio Code"
