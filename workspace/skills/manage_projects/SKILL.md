---
name: manage_projects
version: 1.0.0
description: Create, organize, and manage software projects (scaffold, git init, deps install).
tags: [projects, git, scaffold, builder, devops]
scope: global
agents: [builder, devops]
tools:
  - mcp-terminal (exec, execSafe)
  - mcp-rollback (createSnapshot)
  - mcp-vault (storeExperience)
risk: medium
cost: medium
requires_hitl: false
---

# Skill: Manage Projects

Full project lifecycle: create → scaffold → init → configure → verify.

## Steps

### Create New Project
1. **Snapshot** current state via `mcp-rollback.createSnapshot`.
2. **Scaffold** directory structure via terminal.
3. **Git init** + initial commit.
4. **Install dependencies** (npm/pip/cargo — detect from project type).
5. **Verify** — run lint/typecheck/smoke test.
6. **Register** in vault memory.

### Detect Project Type
```
package.json → Node.js/TypeScript
pyproject.toml / requirements.txt → Python
Cargo.toml → Rust
go.mod → Go
```

## Prompt Pattern

```
Action: manage_projects
operation: create | scaffold | install | verify
project_path: ~/Projects/my-app
project_type: node | python | rust (auto-detect if omitted)
template: express-api | react-app | python-cli | fastapi
```

## Performance Notes

- Run `npm install` and `pip install` in parallel when both needed
- Use `npm ci` instead of `npm install` for reproducibility
- Cache: check if node_modules exists before installing

## Safety Rules

- Never delete existing projects without snapshot + HITL
- Always check disk space before large installs (> 500MB)
