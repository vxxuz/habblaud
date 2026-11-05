# Antigravity Native Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement native Google Antigravity CLI support into Habblaud so that Antigravity sessions, subagents, real-time activity, tokens, and rooms appear live in the pixel-art virtual office without requiring Claude Code.

**Architecture:**
1. Extend `Provider` type to include `'antigravity'` across shared types, server models, and client UI.
2. Build an `AntigravitySource` implementing `AgentSource` (`server/sources/source.ts`):
   - **Detector (`detector.ts`):** Scans `~/.gemini/antigravity-cli/presence/*.lock` checking active flock/inodes and alive PIDs to identify truly active sessions.
   - **Database (`database.ts`):** Uses Node's built-in `node:sqlite` to read room paths (`workspace_uris`), titles, parent session IDs, and metadata from `conversation_summaries.db`.
   - **Transcript Parser (`transcript.ts`):** Reads and tails `brain/<conversationId>/.system_generated/logs/transcript.jsonl`, translating JSONL steps (`USER_INPUT`, `PLANNER_RESPONSE`, `tool_calls`, `ask_question`) into Habblaud activities (`working`, `idle`, `waiting`, tools, token usage).
   - **Source (`source.ts`):** Syncs agents and subagents into Habblaud's `Office` model, tracking lifecycle changes in real time.
3. Wire the source into `server/index.ts` alongside existing providers.

**Tech Stack:** Node.js 22+ (built-in `node:sqlite`, `node:fs`, `node:path`), TypeScript, Vitest.

---

## Global Constraints
- Zero external runtime dependencies: use built-in `node:sqlite` and Node core modules.
- Maintain existing Claude and Codex functionality without regressions.
- Non-blocking file reads and graceful fallback if database or lock files are temporarily busy.

---

## Review Focus
1. **Stale Lock Files:** Presence directory contains orphaned `.lock` files from crashed or closed sessions. Detector must distinguish active sessions (held lock / living PID) from stale locks.
2. **Subagent Hierarchies:** Subagents (`invoke_subagent`) inherit parent conversations; they must be attached to the parent agent as `sub` rather than separate standalone rooms.
3. **Activity State Mapping:** When `ask_question` is called, status must transition to `waiting` (`waitingFor: 'Pergunta'`); during tool execution (`run_command`, `read_file`), status must be `working`; when awaiting user prompt, status is `idle`.
4. **Token Accumulation:** Accurately extract `input_tokens` and `output_tokens` from `PLANNER_RESPONSE` steps to feed the room and account usage metrics.
5. **Real-time Tail:** Tailing `transcript.jsonl` must catch append operations immediately with minimal latency.

---

### Task 1: Core Types & UI Identity for Antigravity

**Files:**
- Modify: `/home/inok/habblaud/shared/types.ts`
- Modify: `/home/inok/habblaud/client/src/ui/provider.ts`
- Test: `/home/inok/habblaud/client/src/ui/provider.test.ts`

**Steps:**
- [ ] Add `'antigravity'` to `Provider` union in `shared/types.ts`.
- [ ] Update `PROVIDER_NAME` in `client/src/ui/provider.ts` to include `antigravity: 'Antigravity'`.
- [ ] Add badge styling and short abbreviation logic (`'AG'`) for Antigravity accounts.
- [ ] Run vitest on `client/src/ui/provider.test.ts` to ensure all tests pass.

---

### Task 2: Antigravity Session & Lock Detector

**Files:**
- Create: `/home/inok/habblaud/server/sources/antigravity/detector.ts`
- Create: `/home/inok/habblaud/server/sources/antigravity/detector.test.ts`

**Steps:**
- [ ] Implement lock inspection in `detector.ts` that checks active locks in `~/.gemini/antigravity-cli/presence/` via inode matching in `/proc/locks` and PID liveness check (`process.kill(pid, 0)`), with mtime fallback for platforms without `/proc`.
- [ ] Filter out stale locks older than settle time if no process holds them.
- [ ] Write unit tests in `detector.test.ts` mocking presence lock files and testing active vs stale identification.
- [ ] Verify test suite passes with `npx vitest run server/sources/antigravity/detector.test.ts`.

---

### Task 3: SQLite Metadata Reader

**Files:**
- Create: `/home/inok/habblaud/server/sources/antigravity/database.ts`
- Create: `/home/inok/habblaud/server/sources/antigravity/database.test.ts`

**Steps:**
- [ ] Use `node:sqlite` (`DatabaseSync` with `{ readOnly: true }`) to query `conversation_summaries.db`.
- [ ] Extract workspace path from `workspace_uris` (e.g. `["file:///home/inok/..."]` -> `/home/inok/...`).
- [ ] Read title, status, parent conversation ID (for subagents), and last modified time.
- [ ] Handle database lock / SQLITE_BUSY gracefully with read retry.
- [ ] Write unit tests in `database.test.ts` using an in-memory SQLite database matching the Antigravity schema.
- [ ] Verify test suite passes with `npx vitest run server/sources/antigravity/database.test.ts`.

---

### Task 4: Transcript Parser & Activity Mapper

**Files:**
- Create: `/home/inok/habblaud/server/sources/antigravity/transcript.ts`
- Create: `/home/inok/habblaud/server/sources/antigravity/transcript.test.ts`

**Steps:**
- [ ] Implement line-by-line JSON parser for Antigravity `transcript.jsonl`.
- [ ] Map steps to agent states:
  - `USER_INPUT` -> status `working` (model thinking).
  - `PLANNER_RESPONSE` with `ask_question` -> status `waiting`, `waitingFor: 'Pergunta'`.
  - `PLANNER_RESPONSE` with tools (`run_command`, `write_file`, etc.) -> status `working` with tool description.
  - Final `PLANNER_RESPONSE` completed without pending tools -> status `idle`.
- [ ] Accumulate `input_tokens` and `output_tokens` across steps.
- [ ] Write comprehensive unit tests in `transcript.test.ts` using real Antigravity JSONL samples.
- [ ] Verify test suite passes with `npx vitest run server/sources/antigravity/transcript.test.ts`.

---

### Task 5: Antigravity AgentSource Implementation

**Files:**
- Create: `/home/inok/habblaud/server/sources/antigravity/source.ts`
- Create: `/home/inok/habblaud/server/sources/antigravity/source.test.ts`

**Steps:**
- [ ] Implement `AntigravitySource` conforming to `AgentSource` interface (`provider = 'antigravity'`).
- [ ] Implement `start()` with `office.beginBoot()` and `office.endBoot()`.
- [ ] Register main agents using `office.addMain({ id, name, roomId, status, account, look, ... })`.
- [ ] Register subagents using `office.addSubagent({ id, parentId, name, role, ... })`.
- [ ] Watch presence locks directory and tail `transcript.jsonl` files using `FileTail`.
- [ ] Dispatch state updates (`office.setStatus`, `office.addActivity`) on transcript updates.
- [ ] Implement `stop()` to clean up watchers and tails.
- [ ] Write unit tests verifying agent lifecycle, subagent addition, and presence updates.
- [ ] Verify test suite passes with `npx vitest run server/sources/antigravity/source.test.ts`.

---

### Task 6: Server Wiring & Integration

**Files:**
- Modify: `/home/inok/habblaud/server/config.ts`
- Modify: `/home/inok/habblaud/server/index.ts`
- Modify: `/home/inok/habblaud/server/sources/source.ts`

**Steps:**
- [ ] Add Antigravity configuration flags in `server/config.ts` (`HABBLAUD_ANTIGRAVITY` env var, auto-detected if `~/.gemini/antigravity-cli` exists).
- [ ] Instantiate `AntigravitySource` and register it into `agents.add(antigravitySource)` in `server/index.ts`.
- [ ] Add startup log message showing detected Antigravity sessions.
- [ ] Run full server tests to ensure zero regressions across the codebase.

---

### Task 7: End-to-End Verification with Live Antigravity Sessions

**Files:**
- Manual & automated end-to-end check.

**Steps:**
- [ ] Start Habblaud in dev mode on port 4747: `npm run dev`.
- [ ] Confirm Antigravity agent appears in the virtual office room representing `/home/inok` (or current workspace).
- [ ] Trigger an activity (e.g. read/write command) and confirm the pixel character types and updates status.
- [ ] Verify token count displayed matches the conversation transcript.
