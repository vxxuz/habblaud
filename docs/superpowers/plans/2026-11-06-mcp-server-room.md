# MCP Server Room & Interactive Control Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the core room below the CEO Suite (`core:boardroom`) into an interactive **MCP Server Room** (`MCP SERVER`) that opens an **MCP Control & Monitoring Panel** in the Drawer connected to `codebase-memory-mcp` and all configured Antigravity MCP servers.

**Architecture:**
1. Redesign `layoutBoardroom()` in `client/src/world/layout/core.ts` as the MCP Server Room with server racks, monitoring displays, operator desk, and `MCP SERVER` wall sign, and make `core:boardroom` clickable in `client/src/world/index.ts`.
2. Build `server/mcp/service.ts` and `server/mcp/routes.ts` to read `~/.gemini/config/mcp_config.json` + `~/.gemini/antigravity-cli/mcp/`, query `codebase-memory-mcp` over stdio JSON-RPC (`list_projects`, `index_status`, `index_repository`, `search_graph`), and expose `/api/mcp/*` endpoints.
3. Build `client/src/ui/mcp-panel.ts` (`McpServerView`) and integrate it into `Drawer` (`client/src/ui/drawer.ts`) and `Sidebar` (`client/src/ui/sidebar.ts`) so clicking the MCP Server Room (or its racks/sidebar entry) opens the interactive control and monitoring panel.

**Tech Stack:** TypeScript, Node.js (`child_process` JSON-RPC stdio client), HTML5 Canvas 2D, Vite, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-06-mcp-server-room-design.md`

## Global Constraints
- All UI and server strings must be in English.
- `coreAreas()` must pass `hiddenWallItems(area) === []`, non-overlapping blocking furniture, and 100% spot reachability in `client/src/world/layout/layout.test.ts`.

## Review Focus
1. Missing or malformed `mcp_config.json` must return an empty server list gracefully without throwing 500.
2. `codebase-memory-mcp` stdio JSON-RPC calls must have a timeout (`15_000` ms) so a slow CLI call never hangs the HTTP server.
3. Clicking any tile inside `core:boardroom` (when not clicking an agent) selects `{ type: 'room', id: 'core:boardroom' }` and opens `McpServerView` in the Drawer.

---

### Task 1: Backend MCP Service & HTTP Routes (`/api/mcp/*`)

**Files:**
- Create: `server/mcp/service.ts`
- Create: `server/mcp/routes.ts`
- Modify: `server/http/app.ts`
- Modify: `server/index.ts`

- [x] **Step 1: Implement `McpControlService` (`server/mcp/service.ts`)**
  - Reads `~/.gemini/config/mcp_config.json` and `~/.gemini/antigravity-cli/mcp/<server>/*.json`.
  - Runs JSON-RPC 2.0 `tools/call` against `codebase-memory-mcp` binary (`list_projects`, `index_status`, `index_repository`, `search_graph`).
  - Collects recent MCP activities (`kind === 'mcp'`) from `Office`.
- [x] **Step 2: Implement `createMcpRoutes` (`server/mcp/routes.ts`) and wire into `server/http/app.ts` & `server/index.ts`**
  - `GET /api/mcp/status`
  - `POST /api/mcp/codebase-memory/index` (`{ repoPath }`)
  - `POST /api/mcp/codebase-memory/search` (`{ project, query }`)

### Task 2: World Layout, Signage & Click Selection for MCP Server Room

**Files:**
- Modify: `client/src/world/layout/core.ts`
- Modify: `client/src/world/render/overlay.ts`
- Modify: `client/src/world/index.ts`

- [x] **Step 1: Update `layoutBoardroom()` in `client/src/world/layout/core.ts` to be the MCP Server Room**
  - Add wall `door_frame`, `sign` (`MCP SERVER`), dual `tv` monitors on north wall, rows of server racks (`arcade`, `binder_shelf`, `filing_cabinet`), and operator console (`desk` + `office_chair`).
- [x] **Step 2: Update `client/src/world/render/overlay.ts` & `client/src/world/index.ts`**
  - Render `'MCP SERVER'` on `core:boardroom` sign and `'MCP Server Room'` pill.
  - Allow clicking and double-clicking `core:boardroom` on the canvas to select `{ type: 'room', id: 'core:boardroom' }` and focus the camera.

### Task 3: Interactive MCP Control & Monitoring Panel in Drawer & Sidebar

**Files:**
- Create: `client/src/ui/mcp-panel.ts`
- Modify: `client/src/ui/drawer.ts`
- Modify: `client/src/ui/sidebar.ts`

- [x] **Step 1: Create `McpServerView` (`client/src/ui/mcp-panel.ts`)**
  - Displays connected MCP servers (`codebase-memory-mcp`, `habblaud-mcp`, etc.), status badges, command paths, and expandable tool schemas.
  - Displays `codebase-memory-mcp` indexed projects with one-click **Re-index**, custom repository path indexing input, and interactive **Knowledge Graph Search** (`search_graph`).
  - Displays live MCP tool activity from office agents.
- [x] **Step 2: Wire `McpServerView` into `Drawer` (`client/src/ui/drawer.ts`) and add quick access in `Sidebar` (`client/src/ui/sidebar.ts`)**
- [x] **Step 3: Run unit tests (`npx vitest run`), build (`npm run build`), restart server (`habblaud_restart_server`), and verify `/api/mcp/status`.**
