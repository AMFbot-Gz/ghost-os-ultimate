# LaRuche Workspace

Human-readable, git-versionnable layer on top of LaRuche's internal stores.

## Structure
- `sessions/`  — Conversation history per agent/session (JSON)
- `memory/`    — Long-term memory entries (Markdown + JSON)
- `skills/`    — Modular skills (SKILL.md frontmatter + optional code)
- `cron/`      — Scheduled jobs (YAML)
- `agents/`    — Agent definitions (AGENT.md / SOUL.md)

## Relation to other stores
- `vault/`       — ChromaDB vector store (auto-managed, not for human editing)
- `.laruche/`    — System config, registry, logs (auto-managed)
- `workspace/`   — YOU edit this; LaRuche reads it at runtime
