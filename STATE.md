# Ghost OS Ultimate — STATE

## Current Phase
Phase 3 — Reasoning Engine Upgrades

## Last Action (2026-03-16)

Three major upgrades were implemented on top of the multi-machine/multi-OS adapter baseline:

1. **ReAct loop** (`brain.py` — `POST /react`)
   - Reason → Act → Observe iterative loop, max 15 steps
   - Dedicated `llm_react()` function routing through Claude with `thinking=False`
   - `_parse_react_step()` extracts Thought/Action/Action Input/Observation from LLM output
   - `_execute_react_action()` dispatches to executor or MCP based on action type
   - Integrated critic check after each destructive action

2. **ChromaDB semantic memory** (`memory.py`)
   - `nomic-embed-text` embeddings via Ollama (768-dimensional vectors)
   - `PersistentClient` stored at `agent/memory/chromadb/`
   - Collection `ghost_os_episodes` — 101 episodes indexed at session end
   - `POST /semantic_search` — pure vector search with cosine similarity threshold (default 0.3)
   - `POST /search` — hybrid: semantic first, falls back to keyword if ChromaDB unavailable
   - `POST /reindex` — full re-index from JSONL source of truth
   - Startup auto-reindex if collection is empty but JSONL has episodes

3. **Critic + auto-rollback** (`brain.py`)
   - `CRITIC_SYSTEM_PROMPT` + `critic_evaluate()` — separate LLM call assessing action outcome
   - `_auto_rollback_cmd()` — pattern-matching rollback (no LLM needed for common cases)
   - `_is_read_only()` — skip critic for read-only commands
   - `_execute_rollback()` — executes the rollback command with timeout
   - Critic integrated in `react_loop()` after each non-read-only action
   - `POST /critic` and `POST /rollback` exposed as standalone endpoints

## System Health

| Layer       | Port  | Status  | File               |
|-------------|-------|---------|--------------------|
| Node.js Queen (MCP/API gateway) | 3000  | running | `core/chimera_bus.js` |
| Queen (Python orchestrator)     | 8001  | running | `agent/queen.py`   |
| Perception                      | 8002  | running | `agent/perception.py` |
| Brain                           | 8003  | running | `agent/brain.py`   |
| Executor                        | 8004  | running | `agent/executor.py` |
| Evolution                       | 8005  | running | `agent/evolution.py` |
| Memory                          | 8006  | running | `agent/memory.py`  |
| MCP Bridge                      | 8007  | running | `agent/mcp_bridge.py` |

ChromaDB: 101 episodes indexed, collection `ghost_os_episodes` healthy.

## What's Running

| Port | Service                        |
|------|-------------------------------|
| 3000 | Node.js Queen — MCP gateway, skills router, API facade |
| 8001 | Python Queen — vital loop orchestrator, mission dispatch |
| 8002 | Perception — screenshot + system scan (30s interval) |
| 8003 | Brain — `/think`, `/react`, `/compress`, `/raw`, `/critic`, `/rollback`, `/health` |
| 8004 | Executor — shell + desktop action execution |
| 8005 | Evolution — Phagocyte self-mutation watcher |
| 8006 | Memory — episodes, semantic search, world state, profile |
| 8007 | MCP Bridge — Claude Code MCP tool relay |

## Pending

From the natural upgrade roadmap:

- **Planner layer** — hierarchical task decomposition before ReAct (STRIPS-style or LLM-based), so multi-step missions get a plan before entering the loop
- **ReAct streaming** — stream intermediate Thought/Observation tokens to the Node.js Queen for real-time UI feedback
- **Critic calibration** — collect critic verdicts over time, fine-tune confidence threshold (currently binary rollback/retry)
- **Selective reindex** — incremental ChromaDB updates on each `POST /episode` already in place, but a delta-sync for bulk imports is missing
- **Skill learning from episodes** — Evolution layer should scan successful ReAct traces and auto-generate reusable skills
- **Memory pruning strategy** — episodes_archive.jsonl exists, but no policy on when archived episodes feed back into semantic search
- **Multi-agent critic** — adversarial second agent challenging the Critic's verdict for high-risk actions
- **Jest test fixtures** — 28 test suites fail due to path/fixture issues in test files (not in production code); needs fixture refactor

## Test Status

### Jest (Node.js)
- 21 suites pass
- 28 suites fail — all failures are path/fixture resolution issues inside test files, not regressions in production code
- Run: `npm test`

### Pytest (Python)
- Configuration in `pytest.ini`, fixtures in `conftest.py`
- Run: `python3 -m pytest`
- Brain endpoints (`/think`, `/react`, `/critic`, `/rollback`) not yet unit-tested; integration tests via Queen
