---
name: devops_logs
version: 1.0.0
description: Analyze, filter, and summarize application and system logs.
tags: [logs, monitoring, devops, debugging]
scope: global
agents: [devops]
tools:
  - mcp-terminal (execSafe)
  - mcp-vault (storeExperience, findSimilar)
risk: low
cost: low
requires_hitl: false
---

# Skill: DevOps Logs

Smart log analysis: tail, filter, pattern detection, root cause suggestions.

## Steps

1. **Identify log source** (PM2, system, app-specific, Docker).
2. **Tail relevant lines** — last 100 lines or since last error.
3. **Filter signal from noise** — grep for ERROR/WARN/CRITICAL/Exception.
4. **Pattern match** — compare against vault memory of known errors.
5. **Root cause hypothesis** — LLM analysis of error context.
6. **Suggest fix** — actionable next step.
7. **Store new patterns** in vault for future reference.

## Log Sources

```bash
# PM2
pm2 logs --lines 100 --nostream

# System (macOS)
log show --predicate 'subsystem == "com.apple.*"' --last 1h

# App-specific
tail -n 100 .laruche/logs/queen.log

# Node.js crashes
cat .laruche/logs/queen-error.log | grep -E "Error|Exception|FATAL"
```

## Prompt Pattern

```
Action: devops_logs
source: pm2 | system | file
target: laruche-queen | all | /path/to/log
filter: ERROR | WARN | all
since: 1h | 100lines | last_error
```

## Output Format

```
📋 Log Analysis — laruche-queen (last 1h)
🔴 3 errors found:
  [04:23:35] TelegramError 409: Conflict...
  [04:23:50] WARN: retry 2/3...
💡 Root cause: Another bot instance using same token
✅ Fix: Run `pkill -f queen_oss && node src/queen_oss.js`
```
