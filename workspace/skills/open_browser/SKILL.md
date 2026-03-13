---
name: open_browser
version: 1.0.0
description: Open a URL in the default browser or a specific browser app.
tags: [browser, web, navigation, operator]
scope: global
agents: [operator]
tools:
  - mcp-os-control (app_launcher, typeText)
  - mcp-vision (analyzeScreen, findElement)
risk: low
cost: low
requires_hitl: false
---

# Skill: Open Browser

Opens a URL in a browser with visual confirmation.

## Steps

1. **Launch browser** via `app_launcher` (Safari / Chrome / Firefox).
2. **Wait for address bar** — vision scan for URL bar element (~1s).
3. **Focus address bar** — Cmd+L (macOS) or click detected element.
4. **Type URL** — `typeText` with the target URL.
5. **Press Enter** — confirm navigation.
6. **Visual validation** — screenshot + check page title/URL matches target.

## Prompt Pattern

```
Action: open_browser
URL: https://example.com
Browser: Safari (default)
Expected: Page loads, title contains "Example"
```

## Error Handling

- If browser doesn't open in 3s → retry once → escalate
- If URL bar not found → try Cmd+L → try clicking top of window
- If navigation fails (404/error) → report with screenshot

## Performance Notes

- Batch: if opening multiple URLs, use tabs (Cmd+T) instead of re-launching
- Cache: reuse existing browser window if already open (vision check first)
