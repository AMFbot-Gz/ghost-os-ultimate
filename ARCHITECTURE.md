# Ghost OS Ultimate — Architecture

Version 1.0.0 — Phase 3 (Reasoning Engine Upgrades)
Last updated: 2026-03-16

---

## Layer Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Ghost OS Ultimate                            │
│                                                                     │
│   ┌──────────────────────────────────────────────────────────┐     │
│   │              Node.js Queen  :3000                        │     │
│   │    MCP gateway · Skills router · API facade              │     │
│   │    chimera_bus.js · phagocyte.js                         │     │
│   └────────────────────────┬─────────────────────────────────┘     │
│                            │ localhost HTTP                         │
│   ┌────────────────────────▼─────────────────────────────────┐     │
│   │              Python Queen  :8001                         │     │
│   │    Vital loop (30s) · Mission dispatch · Orchestration   │     │
│   │    queen.py                                              │     │
│   └──┬──────────┬──────────┬──────────┬──────────┬──────────┘     │
│      │          │          │          │          │                  │
│  :8002       :8003      :8004      :8005      :8006      :8007     │
│  ┌───▼──┐  ┌───▼──┐  ┌───▼──┐  ┌───▼──┐  ┌───▼──┐  ┌───▼──┐    │
│  │Percep│  │Brain │  │Exec  │  │Evolu │  │Memory│  │MCP   │    │
│  │tion  │  │      │  │ utor │  │ tion │  │      │  │Bridge│    │
│  │      │  │      │  │      │  │      │  │      │  │      │    │
│  │screen│  │/think│  │shell │  │Phago-│  │JSONL │  │Claude│    │
│  │shot  │  │/react│  │dektop│  │cyte  │  │Chroma│  │Code  │    │
│  │system│  │/critic│ │auto- │  │self- │  │world │  │MCP   │    │
│  │scan  │  │/rollbk│ │mation│  │mutate│  │state │  │relay │    │
│  └──────┘  └──────┘  └──────┘  └──────┘  └──────┘  └──────┘    │
│                                                                     │
│   External: Ollama :11434 (llama3, llama3.2:3b, moondream,        │
│             nomic-embed-text)  ·  Anthropic API (Claude)           │
└─────────────────────────────────────────────────────────────────────┘
```

---

## brain.py Endpoint Map  (:8003)

| Method | Path        | Function            | Description |
|--------|-------------|---------------------|-------------|
| POST   | /think      | `think()`           | Single-shot structured planning. Returns subtasks, risk level, immediate action. Used by vital loop. Supports adaptive thinking. |
| POST   | /react      | `react()`           | Iterative ReAct loop. Calls `react_loop()` up to 15 steps. Each step: Thought → Action → Observation. Critic runs after each destructive action. |
| POST   | /compress   | `compress()`        | Compresses a message list to a summary string. Used when context exceeds `compress_threshold` tokens. |
| POST   | /raw        | `raw_llm()`         | Raw LLM call, no system prompt injection, no context management. Debug/utility endpoint. |
| POST   | /critic     | `critic_endpoint()` | Standalone Critic evaluation. Takes action, action_input, exec_result, expected. Returns verdict: `ok` / `retry` / `rollback` + reason. |
| POST   | /rollback   | `rollback_endpoint()` | Executes a rollback command string with a timeout. Returns stdout/stderr/returncode. |
| GET    | /health     | `health()`          | Returns layer name, model config, Claude/MLX availability flags. |

---

## memory.py Endpoint Map  (:8006)

| Method | Path                         | Function                     | Description |
|--------|------------------------------|------------------------------|-------------|
| POST   | /episode                     | `save_episode()`             | Append episode to JSONL, trigger async ChromaDB index. |
| GET    | /episodes                    | `get_episodes()`             | Return last N episodes (default 20, reversed chronological). |
| POST   | /search                      | `search_episodes()`          | Hybrid search: semantic (ChromaDB) first, keyword fallback. |
| POST   | /semantic_search             | `semantic_search_endpoint()` | Pure ChromaDB vector search. Returns episodes ranked by cosine similarity above threshold. |
| POST   | /reindex                     | `reindex()`                  | Full re-index: read all JSONL episodes, upsert into ChromaDB. Returns count. |
| GET    | /episodes/by_machine/{id}    | `get_episodes_by_machine()`  | Filter episodes by machine_id metadata field. |
| GET    | /world                       | `get_world_state()`          | Return current world_state.json. |
| POST   | /world                       | `update_world_state()`       | Atomic merge-update of world_state.json fields. |
| GET    | /profile                     | `get_profile()`              | Return agent profile (identity, capabilities, persistent learnings). |
| GET    | /health                      | `health()`                   | ChromaDB readiness, episode count, JSONL path. |

---

## ReAct Loop Flow

```
POST /react  { mission, context, max_steps=15 }
        │
        ▼
  react_loop()
        │
        ├─ Build system prompt (domain context + skills list + recent learnings)
        │
        ├─ STEP LOOP (i = 1 .. max_steps)
        │      │
        │      ├─ llm_react(messages)          ← Claude, thinking=False
        │      │      │
        │      │      └─ Returns text with format:
        │      │           Thought: <reasoning>
        │      │           Action: <skill_name or FINISH>
        │      │           Action Input: <json or string>
        │      │
        │      ├─ _parse_react_step(text)
        │      │      └─ Extracts: thought, action, action_input
        │      │         Sets: finish=True if Action == FINISH
        │      │
        │      ├─ [if finish] → break loop, return final answer
        │      │
        │      ├─ _execute_react_action(action, action_input, timeout)
        │      │      └─ Dispatch to Executor :8004 or MCP Bridge :8007
        │      │         Returns: { success, output, error }
        │      │
        │      ├─ [if not _is_read_only(action_input)]
        │      │      │
        │      │      └─ critic_evaluate(action, action_input, result, expected)
        │      │             │
        │      │             ├─ _auto_rollback_cmd(action_input)
        │      │             │      └─ Pattern match → rollback cmd string or None
        │      │             │
        │      │             ├─ llm_react(messages, CRITIC_SYSTEM_PROMPT)
        │      │             │      └─ Returns: { verdict: ok|retry|rollback, reason }
        │      │             │
        │      │             ├─ [verdict == rollback]
        │      │             │      └─ _execute_rollback(rollback_cmd)
        │      │             │         Append obs_suffix: [CRITIC ABORT — reason]
        │      │             │
        │      │             └─ [verdict == retry]
        │      │                    Append obs_suffix: [CRITIC RETRY — reason]
        │      │
        │      └─ Append Observation to messages → next step
        │
        └─ Return { steps, final_answer, success, total_steps }
```

---

## Critic Integration Diagram

```
                    ReAct Step N
                         │
                         ▼
               _execute_react_action()
                         │
                         ▼
              ┌──────────────────────┐
              │  _is_read_only()?    │
              └──────────────────────┘
                   │           │
                  YES          NO
                   │           │
                   │           ▼
                   │   _auto_rollback_cmd()
                   │      │            │
                   │   MATCHED       NO MATCH
                   │      │            │
                   │      └────┬───────┘
                   │           ▼
                   │   critic_evaluate()
                   │      │
                   │      ▼
                   │   llm_react(CRITIC_SYSTEM_PROMPT)
                   │      │
                   │      ├─ verdict: ok      → continue loop
                   │      ├─ verdict: retry   → add [CRITIC RETRY] suffix
                   │      └─ verdict: rollback→ _execute_rollback()
                   │                            add [CRITIC ABORT] suffix
                   │
                   └──────────────────────────────▶ next step
```

---

## ChromaDB Data Flow

```
Episode arrives via POST /episode
         │
         ▼
 atomic append → episodes.jsonl   (source of truth)
         │
         ▼  (asyncio.create_task)
 _index_episode(episode)
         │
         ├─ _episode_to_text(ep)
         │    → "Mission: X\nResult: Y\nLearned: Z\nSkills: [...]"
         │
         ├─ _get_embedding(text)
         │    → POST http://localhost:11434/api/embeddings
         │       model: nomic-embed-text
         │       → 768-dimensional float vector
         │
         └─ _chroma_collection.upsert(
                id=sha256(mission|timestamp),
                embeddings=[vector],
                documents=[text],
                metadatas=[{timestamp, success, duration_ms,
                            model_used, machine_id, skills_used}]
            )

POST /semantic_search { query, n_results, min_similarity }
         │
         ├─ _get_embedding(query)  → query vector
         │
         └─ _chroma_collection.query(
                query_embeddings=[query_vec],
                n_results=n_results
            )
            → filter by (1 - distance) >= min_similarity
            → return ranked episodes with similarity scores

POST /reindex
         │
         ├─ _read_episodes_safe(episodes.jsonl)
         └─ for each episode → _index_episode(ep)
            → logs indexed/total count
```

---

## File Structure Overview

```
ghost-os-ultimate/
├── agent/                          # Python agent layer
│   ├── brain.py                    # Brain :8003 — /think /react /critic /rollback /compress /raw
│   ├── memory.py                   # Memory :8006 — /episode /search /semantic_search /reindex /world /profile
│   ├── perception.py               # Perception :8002 — screenshot, system scan
│   ├── executor.py                 # Executor :8004 — shell, desktop automation
│   ├── evolution.py                # Evolution :8005 — Phagocyte, self-mutation
│   ├── queen.py                    # Python Queen :8001 — vital loop, orchestration
│   ├── mcp_bridge.py               # MCP Bridge :8007 — Claude Code relay
│   ├── claude_architecte.py        # Claude API helper (architecte role)
│   ├── layer_manager.py            # Layer lifecycle manager
│   ├── memory/
│   │   ├── episodes.jsonl          # Episode store (source of truth)
│   │   ├── episodes_archive.jsonl  # Overflow archive
│   │   ├── persistent.md           # Persistent learnings log
│   │   ├── world_state.json        # World state snapshot
│   │   └── chromadb/               # ChromaDB PersistentClient files
│   ├── skills/                     # Agent-side skill helpers
│   ├── agents/                     # Sub-agent definitions
│   ├── logs/                       # Per-layer log files
│   └── layers/                     # Layer config/state
│
├── core/                           # Node.js Queen layer
│   ├── chimera_bus.js              # Node.js Queen :3000 — MCP gateway, skills router
│   ├── phagocyte.js                # Self-mutation watcher
│   ├── consciousness/
│   ├── events/
│   ├── monitoring/
│   ├── platforms/
│   └── skills/                     # Node.js skill wrappers
│
├── skills/                         # 28 MCP-exposed skills
│   ├── registry.json               # Skill registry manifest
│   ├── SKILL.md                    # Skill authoring guide
│   ├── index.js                    # Skills loader
│   ├── run_command/
│   ├── run_shell/
│   ├── take_screenshot/
│   ├── goto_url/
│   ├── http_fetch/
│   ├── read_file/
│   ├── open_app/
│   ├── type_text/
│   ├── smart_click/
│   ├── find_element/
│   ├── screen_elements/
│   ├── wait_for_element/
│   ├── mouse_control/
│   ├── press_key/
│   ├── press_enter/
│   ├── accessibility_reader/
│   ├── agent_bridge/
│   ├── invoke_claude_code/
│   ├── list_big_files/
│   ├── open_google/
│   ├── organise_screenshots/
│   ├── organise_telechargements/
│   ├── summarize_project/
│   ├── telegram_notify/
│   ├── update_world_state/
│   └── ...
│
├── src/                            # Shared source (Node.js)
├── tests/                          # Jest + Pytest test suites
├── scripts/                        # Build/start/stop scripts
├── config/                         # Runtime configuration
├── data/                           # Static data / fixtures
├── vault/                          # Secrets (not committed)
├── workspace/                      # Agent working directory
├── mutations/                      # Phagocyte mutation records
├── mcp_servers/                    # MCP server definitions
├── models/                         # Local model configs
├── tools/                          # CLI utilities
├── daemon/                         # OS daemon wrappers
├── interfaces/                     # API interface definitions
├── ecosystem/                      # PM2 ecosystem (legacy)
│
├── agent_config.yml                # Central config (ports, models, intervals)
├── ecosystem.config.js             # PM2 process definitions
├── docker-compose.yml              # Container definitions (optional)
├── package.json                    # Node.js deps (ESM, Jest)
├── requirements.txt                # Python deps
├── requirements-runtime.txt        # Runtime-only Python deps
├── requirements-dev.txt            # Dev Python deps
├── jest.config.cjs                 # Jest configuration
├── pytest.ini                      # Pytest configuration
├── conftest.py                     # Pytest fixtures
├── start_agent.py                  # Agent start script
├── stop_agent.py                   # Agent stop script
├── ARCHITECTURE.md                 # This file
├── DECISIONS.md                    # Architectural decision records
├── STATE.md                        # Current system state
├── HEARTBEAT.md                    # Vital signs log
└── README.md                       # Project overview
```

---

## Key Data Contracts

### ReAct Request (POST /react)
```json
{
  "mission": "string — task description",
  "context": "string — optional extra context",
  "max_steps": 15,
  "step_timeout": 30
}
```

### ReAct Response
```json
{
  "success": true,
  "final_answer": "string",
  "total_steps": 4,
  "steps": [
    {
      "step": 1,
      "thought": "string",
      "action": "run_command",
      "action_input": "ls -la",
      "observation": "string",
      "critic": { "verdict": "ok", "reason": "read-only" }
    }
  ]
}
```

### Critic Request (POST /critic)
```json
{
  "action": "run_command",
  "action_input": "rm file.txt",
  "exec_result": { "success": false, "output": "", "error": "No such file" },
  "expected_outcome": "Delete file.txt"
}
```

### Critic Response
```json
{
  "verdict": "rollback",
  "reason": "Command failed with error — file not found",
  "rollback_cmd": null,
  "auto_rollback": false
}
```

### Semantic Search Request (POST /semantic_search)
```json
{
  "query": "string — natural language query",
  "n_results": 5,
  "min_similarity": 0.3
}
```

### Semantic Search Response
```json
{
  "results": [
    {
      "episode": { "mission": "...", "timestamp": "...", "success": true },
      "similarity": 0.87,
      "method": "semantic"
    }
  ],
  "total": 5,
  "chroma_ready": true
}
```
