# Antigravity Interactive Web Terminal & Session Picker Plan

**Goal:** Allow users to choose which Antigravity session to work on from the Habblaud UI, and access/resume that session interactively inside an embedded web terminal (running `agy --conversation <id>` via `node-pty` and `xterm.js`).

**Architecture:**
1. **Binary Detection (`server/pty/antigravity-bin.ts`):** Detects the `agy` CLI binary (`HABBLAUD_ANTIGRAVITY_BIN` or `/home/inok/.local/bin/agy` or `PATH`).
2. **PTY Manager Support (`server/pty/manager.ts`):**
   - Supports spawning `agy` in pseudo-terminal sessions.
   - When resuming an Antigravity session: runs `agy --conversation <sessionId>` in the session's workspace directory.
   - When starting a new session: runs `agy` in the project directory.
3. **Antigravity History Provider (`server/sources/antigravity/history.ts`):**
   - Implements `HistoryProvider` (`server/sources/source.ts`).
   - Reads historical & active sessions from `conversation_summaries.db`, serving `/api/sessions/recent` and `/api/sessions/<account>/<sessionId>/terminal` so the UI History Picker displays all past Antigravity conversations.
4. **Client UI Controls (`client/src/ui/ptyapi.ts`, `client/src/ui/drawer.ts`, `client/src/ui/history.ts`):**
   - Updates `ptyControllable(agent)` to return `true` for `antigravity` agents.
   - Enables "Open Terminal" / "Resume Session" button in the Drawer and History Picker.
5. **Auto PTY Enablement (`server/index.ts`):**
   - Auto-enables PTY when `agy` is available on the machine.

**Tech Stack:** Node.js 22+, `node-pty`, TypeScript, SQLite (`node:sqlite`), `xterm.js`, Vitest.

---

## Global Constraints
- Pure Node.js runtime and existing dependencies.
- Zero breaking changes to existing Claude or Codex PTY workflows.
- Security: PTY remains restricted to localhost loopback connections.

---

### Task 1: Antigravity CLI Binary Locator
- [x] Create `findAgyBin(env?: NodeJS.ProcessEnv): string | undefined`.
- [x] Verify standard search locations: `HABBLAUD_ANTIGRAVITY_BIN`, `~/.local/bin/agy`, and system `PATH`.
- [x] Write unit tests verifying custom env override, PATH lookup, and absence fallback.
- [x] Run vitest to verify test passes.

---

### Task 2: Antigravity History Provider (Session Picker Backend)
- [x] Implement `AntigravityHistory` implementing `HistoryProvider`.
- [x] Implement `list()` querying `conversation_summaries.db` for recent sessions with title, cwd, lastModified, and presence status.
- [x] Implement `resolve(account, sessionId)` returning transcript path and session details.
- [x] Write unit tests using synthetic SQLite database and verify with Vitest.

---

### Task 3: PTY Manager Multi-CLI & Resume Support
- [x] Add `agyBin?: string` to `PtyManagerOptions`.
- [x] Update `PtyManager.spawn` so that when `account.provider === 'antigravity'` or `agyBin` is selected:
  - If `resume`: args are `['--conversation', sessionId]`.
  - If new: args are `[]`.
  - Executable is `agyBin`.
- [x] Update `takeover` and `stopAgent` to handle Antigravity process termination cleanly.
- [x] Run vitest on PTY manager tests.

---

### Task 4: Client UI Integration (Drawer & History Drawer)
- [x] Update `ptyControllable(a)` to include `antigravity` agents.
- [x] Update Drawer alert text to point to Antigravity terminal when waiting.
- [x] Enable resume actions from the Session History drawer for Antigravity sessions.
- [x] Rebuild client bundle (`npm run build:client`).

---

### Task 5: Server Wiring & Auto-Opt-In
- [x] Wire `AntigravityHistory` into `history` (`HistorySet`).
- [x] Auto-enable interactive PTY when `agyBin` is found and `spawnPty` is loaded.
- [x] Update server startup log to display interactive terminal status for Antigravity (`agy`).
- [x] Rebuild server bundle (`npm run build:server`).

---

### Task 6: End-to-End Verification
- [x] Run full test suite (`npx vitest run`: 164 test files, 1902 tests passed).
- [x] Start server and fetch `/api/sessions/recent`, confirming all Antigravity conversations from `conversation_summaries.db` are returned.
- [x] Test PTY and streaming transcript endpoints for Antigravity sessions.
