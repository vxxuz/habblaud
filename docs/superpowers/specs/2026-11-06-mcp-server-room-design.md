# MCP Server Room & Interactive Control Panel Design

## 1. Intent & Why
Users running Antigravity with MCP servers (`codebase-memory-mcp`, `habblaud-mcp`, etc.) need a dedicated **MCP Server Room** inside the virtual office building where they can click the room or its server racks to open an interactive **MCP Control & Monitoring Panel**. This provides visibility and control over connected MCP servers, knowledge-graph projects (`codebase-memory-mcp`), indexed repositories, and live MCP tool activity directly from the Habblaud web UI.

## 2. Goals & Non-Goals
- **Goals:**
  - Transform the core room at Column 2 South (`core:boardroom` below the CEO Suite) into the **MCP Server Room** (`MCP SERVER` sign, dark technical floor, server racks/cabinets, monitoring screens, and operator consoles).
  - Make clicking the MCP Server Room (on the map or via the sidebar) open the **MCP Control & Monitoring Panel** in the right-hand Drawer.
  - Provide backend `/api/mcp/*` endpoints that:
    1. Discover configured MCP servers from `~/.gemini/config/mcp_config.json` and tool schemas from `~/.gemini/antigravity-cli/mcp/<server>/*.json`.
    2. Connect to `codebase-memory-mcp` (via JSON-RPC stdio call to its binary) to list indexed projects (`list_projects`), check index status (`index_status`), trigger repository indexing (`index_repository`), and run quick symbol searches (`search_graph`).
    3. Track recent MCP tool calls (`kind === 'mcp'`) across all active agents in the office.
- **Non-Goals:**
  - Adding extra building columns that widen the map unnecessarily.
  - Modifying external MCP server binaries.

## 3. Approaches Considered
1. **Approach 1 (Selected): Core Server Room Below CEO Suite + Drawer Control Panel**
   - Repurposes Column 2 South (`core:boardroom`) into the MCP Server Room and integrates the control panel into the existing `Drawer` (`client/src/ui/drawer.ts`) when `{ type: 'room', id: 'core:boardroom' }` is selected.
   - *Advantage:* Keeps the 4-column building compact and uses the native Habblaud selection/drawer flow without blocking the canvas.
2. **Approach 2: Additional Building Column + Center Modal Dialog**
   - Adds a 5th column and opens a floating modal over the canvas.
   - *Rejected:* Widens the building layout and covers the live office view.

## 4. Architecture & Components
1. **World Layout & Rendering (`client/src/world/`):**
   - `layoutBoardroom()` in `client/src/world/layout/core.ts`: redesigned as the **MCP Server Room** with dark tile floor, rows of server racks (`filing_cabinet` / `binder_shelf` / `arcade` terminals), wall `tv` monitors, and a `sign` (`MCP SERVER`).
   - `client/src/world/render/overlay.ts`: adds `'core:ceo': 'CEO Suite'` and `'core:boardroom': 'MCP Server Room'` to `CORE_NAMES` and renders `'MCP SERVER'` on the room's wall sign and selection highlight.
   - `client/src/world/index.ts`: updates `pick()` and `focusRoom()` so clicking or double-clicking `core:boardroom` selects `{ type: 'room', id: 'core:boardroom' }`.
2. **Backend MCP Service (`server/mcp/service.ts` & `server/mcp/routes.ts`):**
   - Reads `~/.gemini/config/mcp_config.json` and `~/.gemini/antigravity-cli/mcp/` to list configured MCP servers, their commands, status, and tool schemas (name + description).
   - Executes JSON-RPC 2.0 requests (`initialize` + `tools/call`) against `codebase-memory-mcp` to support:
     - `GET /api/mcp/status`: all MCP servers, tools, `codebase-memory-mcp` indexed projects, and recent MCP activity from office agents.
     - `POST /api/mcp/codebase-memory/index`: triggers `index_repository` on a given `repo_path`.
     - `POST /api/mcp/codebase-memory/search`: runs `search_graph` (`project`, `name_pattern`) and returns matching graph nodes.
3. **Interactive Drawer Panel (`client/src/ui/mcp-panel.ts` & `client/src/ui/drawer.ts`):**
   - When `sel.type === 'room' && sel.id === 'core:boardroom'` is selected, `Drawer` renders `McpServerView` with:
     - **Connected MCP Servers** (status badge, command path, expandable tool list).
     - **Codebase Memory Graph** (indexed projects list, Re-index button, custom path index input, and interactive Graph Symbol Search).
     - **Recent MCP Activity** (live feed of `🔌 Calling MCP (...)` calls from agents).
