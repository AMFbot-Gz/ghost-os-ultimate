# LaRuche Memory

Each entry is a markdown section with frontmatter-style metadata.
Entries are loaded into agent context at session start (filtered by relevance).
Long-term facts, learned rules, user preferences.

---

## Format

```yaml
id: mem_001
type: fact|rule|preference|error_lesson
scope: global|agent:operator|agent:devops
tags: [macos, terminal, safety]
created: 2026-03-11
confidence: high
```

Content of the memory entry here.

---

## Entries

```yaml
id: mem_001
type: preference
scope: global
tags: [language, output]
created: 2026-03-11
confidence: high
```
Always respond in French. Use English for technical terms (function names, commands, logs).

---

```yaml
id: mem_002
type: rule
scope: agent:operator
tags: [macos, retina, coordinates]
created: 2026-03-11
confidence: high
```
macOS Retina screens use a 2x DPI scale. All HID coordinates must be divided by 2 before sending to PyAutoGUI. Use relative coordinates (0-100%) when possible.

---

```yaml
id: mem_003
type: error_lesson
scope: global
tags: [telegram, bot, polling]
created: 2026-03-11
confidence: high
```
When a 409 Conflict occurs on Telegram getUpdates, call getUpdates?timeout=0 first to steal the session, wait 2s, then relaunch. Never await bot.launch() — it blocks forever in Telegraf 4.x.
