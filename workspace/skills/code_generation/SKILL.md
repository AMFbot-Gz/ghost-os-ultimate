---
name: code_generation
version: 1.0.0
description: Generate production-ready code (functions, modules, APIs, tests).
tags: [code, generation, builder, typescript, python, javascript]
scope: global
agents: [builder]
tools:
  - mcp-terminal (exec)
  - mcp-skill-factory (createSkill, testSkill)
  - mcp-vault (findSimilar, storeExperience)
risk: low
cost: high
requires_hitl: false
temperature_override: 0.1
---

# Skill: Code Generation

Chain-of-Thought code generation with self-critique and testing.

## Process

### Phase 1: Context
1. Search vault for similar past code (`mcp-vault.findSimilar`).
2. Check existing codebase patterns (`mcp-terminal.execSafe ls src/`).
3. Identify language, framework, conventions.

### Phase 2: Draft
Generate complete code. Rules:
- No placeholders or `// TODO`
- Full error handling
- TypeScript strict types when applicable
- Follow existing naming conventions

### Phase 3: Critique
Self-review checklist:
- [ ] Handles edge cases?
- [ ] No hardcoded secrets/paths?
- [ ] Async/await correct?
- [ ] Imports complete?

### Phase 4: Refactor
Fix issues found in critique. Output final version.

### Phase 5: Test
```bash
node --check generated_file.js  # Syntax check
node -e "import('./generated_file.js')"  # Import test
```

## Templates Available

- `express-route` — REST API endpoint with validation
- `ollama-tool` — MCP tool implementation
- `react-component` — React component with props/state
- `python-async` — Python async function with error handling
- `cli-command` — Commander.js CLI command
