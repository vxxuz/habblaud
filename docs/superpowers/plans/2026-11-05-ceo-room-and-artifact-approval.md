# Executive CEO Suite & Native Artifact Approval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a dedicated Executive CEO Suite (`core:ceo`) with a permanent CEO avatar ("Inok, CEO"), automatically detect Antigravity artifacts requiring user feedback (`requestFeedback: true` in `*.metadata.json`), route characters to walk to the CEO desk to present the artifact, and provide an interactive approval card in Habblaud where the user can Approve or Reject before the agent returns to work.

**Architecture:**
- **Layout:** Add `layoutCeoSuite()` in `client/src/world/layout/core.ts` with executive furniture, luxury carpet, CEO desk, and a visitor presentation spot (`ceo_visitor`).
- **Resident Avatar:** Place a permanent CEO avatar (`ceo:inok`) seated at the CEO desk.
- **Backend Scanner:** Monitor `~/.gemini/antigravity-cli/brain/<sessionId>/*.metadata.json` in `server/sources/antigravity/artifacts.ts`. Only artifacts with `requestFeedback: true` trigger a pending approval state.
- **Simulation:** In `client/src/world/sim/sim.ts`, agents with pending artifacts navigate to `ceo_visitor` spot, face the CEO, and hold a document bubble until approved.
- **Decision API & UI:** `POST /api/ceo/decision` approves or rejects the artifact, dispatching the decision natively through `MessageRegistry` (`[Approved] ...`), causing the agent to bow/cheer and walk back to their room.

**Tech Stack:** TypeScript, Node.js, Canvas 2D World Simulation, Vitest.

**Spec:** [ceo-room-and-artifact-approval-design.md](file:///home/inok/.gemini/antigravity-cli/brain/deb479cb-eaff-4799-846f-2bb9bc04211f/ceo-room-and-artifact-approval-design.md)

## Global Constraints
- Pure Node.js runtime and existing dependencies (no third-party plugins).
- Zero breaking changes to existing room layouts or Claude/Codex workflows.
- Artifacts with `requestFeedback: false` MUST NOT trigger a CEO room visit.
- Decisions must be delivered directly using native Antigravity message dispatching.

## Review Focus
1. Artifact with `requestFeedback: false` remains in workstation and does not walk to CEO.
2. Multiple sessions generating artifacts queue or present gracefully at the CEO visitor spot.
3. Pathfinding unobstructed between all project rooms and the CEO Suite.
4. Approval action dispatches `[Approved] <name>` into Antigravity session and marks artifact resolved.
5. Character resumes normal work state at their own workstation after decision is recorded.

---

### Task 1: CEO Suite Layout & Visitor Presentation Spot
**Files:**
- Modify: `client/src/world/constants.ts`
- Modify: `client/src/world/layout/core.ts`
- Modify: `client/src/world/layout/building.ts`
- Test: `client/src/world/layout/layout.test.ts`

**Interfaces:**
- Consumes: `AreaBuilder`, `SpotDef`, `AreaLayout` from `client/src/world/layout/`
- Produces: `CEO_ID = 'core:ceo'`, `layoutCeoSuite(): AreaLayout`

- [ ] **Step 1: Write test for CEO suite layout**
  Add unit tests in `client/src/world/layout/layout.test.ts` verifying `core:ceo` exists in `coreAreas()`, has valid walkable tiles, contains a `ceo_visitor` spot with group `'ceo'`, and contains executive furniture.
- [ ] **Step 2: Run test to verify failure**
  Run `npx vitest run client/src/world/layout/layout.test.ts` (expect failure because `layoutCeoSuite` is not yet defined).
- [ ] **Step 3: Implement `layoutCeoSuite()` in `client/src/world/layout/core.ts`**
  Define `CEO_ID = 'core:ceo'`, layout executive room with dark mahogany wood floor, executive desk, chair, plants, and visitor spot `ceo_visitor`.
- [ ] **Step 4: Register `layoutCeoSuite()` in `building.ts`**
  Add `layoutCeoSuite()` to `coreAreas()`.
- [ ] **Step 5: Run tests to verify pass**
  Run `npx vitest run client/src/world/layout/layout.test.ts`.
- [ ] **Step 6: Commit**
  `git commit -m "feat(layout): add executive CEO suite and visitor presentation spot"`

---

### Task 2: Permanent CEO Avatar ("Inok")
**Files:**
- Modify: `client/src/world/sim/sim.ts`
- Modify: `client/src/world/sim/character.ts`
- Test: `client/src/world/sim/sim.test.ts`

**Interfaces:**
- Consumes: `CEO_ID`, `ceo` spots from Task 1
- Produces: Persistent CEO resident avatar `ceo:inok` seated at the CEO desk

- [ ] **Step 1: Write test for CEO character presence**
  Verify in `client/src/world/sim/sim.test.ts` that the world simulation spawns the CEO character at the CEO desk in `core:ceo` with name "Inok (CEO)".
- [ ] **Step 2: Run test to verify failure**
- [ ] **Step 3: Implement CEO character in `client/src/world/sim/sim.ts`**
  Initialize `ceo:inok` character, seated behind the executive desk facing South (`down`), styled in executive attire.
- [ ] **Step 4: Run test to verify pass**
  Run `npx vitest run client/src/world/sim/sim.test.ts`.
- [ ] **Step 5: Commit**
  `git commit -m "feat(sim): add permanent CEO avatar at executive desk"`

---

### Task 3: Antigravity Artifact Scanner (`requestFeedback: true` filtering)
**Files:**
- Create: `server/sources/antigravity/artifacts.ts`
- Create: `server/sources/antigravity/artifacts.test.ts`
- Modify: `server/sources/antigravity/index.ts`
- Modify: `shared/types.ts`

**Interfaces:**
- Consumes: Session brain path `~/.gemini/antigravity-cli/brain/<sessionId>/*.metadata.json`
- Produces: `scanSessionArtifacts(brainDir: string, approvedSet: Set<string>): PendingArtifact[]`
- Produces: `AgentInfo.pendingArtifact?: PendingArtifact`

- [ ] **Step 1: Write tests for artifact scanner**
  Test scanning a brain directory with artifacts:
  - `requestFeedback: true` -> returned as pending.
  - `requestFeedback: false` -> filtered out.
  - Already approved artifact -> filtered out.
- [ ] **Step 2: Run test to verify failure**
  Run `npx vitest run server/sources/antigravity/artifacts.test.ts`.
- [ ] **Step 3: Implement `ArtifactScanner` in `server/sources/antigravity/artifacts.ts`**
  Reads `*.metadata.json` and matching `.md` files, checks `requestFeedback`, compares with approved store (`~/.habblaud/approved_artifacts.json`).
- [ ] **Step 4: Wire scanner into Antigravity source in `server/sources/antigravity/index.ts`**
  Attach `pendingArtifact` to the corresponding `AgentInfo` in snapshot.
- [ ] **Step 5: Run tests to verify pass**
  Run `npx vitest run server/sources/antigravity/artifacts.test.ts`.
- [ ] **Step 6: Commit**
  `git commit -m "feat(antigravity): add artifact scanner with requestFeedback filtering"`

---

### Task 4: Character Navigation to CEO Suite on Pending Artifact
**Files:**
- Modify: `client/src/world/sim/behavior.ts`
- Modify: `client/src/world/sim/sim.ts`
- Test: `client/src/world/sim/sim.test.ts`

**Interfaces:**
- Consumes: `agent.pendingArtifact` from Task 3, `ceo_visitor` spot from Task 1
- Produces: Automatic pathfinding to CEO Suite when `pendingArtifact` is active, presentation animation at desk, and return to workstation upon resolution.

- [ ] **Step 1: Write test for character routing to CEO**
  In `sim.test.ts`, when `agent.pendingArtifact` is set, verify the character's target destination is the `ceo_visitor` spot, facing `up`. When `pendingArtifact` is cleared, target reverts to project desk (`home`).
- [ ] **Step 2: Run test to verify failure**
- [ ] **Step 3: Update `sim.ts` and `behavior.ts`**
  When `agent.pendingArtifact` is defined, navigate to `ceo_visitor`. Upon arrival, play presentation pose (`read` / `raise_hand` / document bubble).
- [ ] **Step 4: Run tests to verify pass**
  Run `npx vitest run client/src/world/sim/sim.test.ts`.
- [ ] **Step 5: Commit**
  `git commit -m "feat(sim): navigate agents to CEO suite when presenting artifacts"`

---

### Task 5: Executive Review API & Decision Drawer UI
**Files:**
- Create: `server/ceo/routes.ts`
- Create: `server/ceo/routes.test.ts`
- Modify: `server/index.ts`
- Create: `client/src/ui/ceo-card.ts`
- Modify: `client/src/ui/drawer.ts`
- Modify: `client/src/world/sim/sim.ts`

**Interfaces:**
- Consumes: `POST /api/ceo/decision` with `{ agentId, artifactName, decision: 'approve' | 'reject', feedback? }`
- Dispatches: Native approval text `[Approved] <artifactName>` via `MessageRegistry`
- Produces: Interactive Executive Review Card in client drawer.

- [ ] **Step 1: Write test for `POST /api/ceo/decision`**
  Verify that approving an artifact records approval in `approved_artifacts.json`, triggers `MessageRegistry` delivery to session, and updates agent state.
- [ ] **Step 2: Run test to verify failure**
- [ ] **Step 3: Implement `server/ceo/routes.ts` and wire into `server/index.ts`**
  Handle `POST /api/ceo/decision`.
- [ ] **Step 4: Implement `CeoApprovalCard` in `client/src/ui/ceo-card.ts` and wire into `drawer.ts`**
  Show artifact title, summary, and Approve / Reject buttons when clicking visiting agent or CEO.
- [ ] **Step 5: Run tests to verify pass**
  Run `npx vitest run server/ceo/routes.test.ts`.
- [ ] **Step 6: Commit**
  `git commit -m "feat(ceo): add executive decision API and interactive approval card"`

---

### Task 6: End-to-End Build & Live Verification
**Files:** All modified files

- [ ] **Step 1: Build client and server**
  Run `npm run build` in `/home/inok/habblaud`.
- [ ] **Step 2: Run full vitest test suite**
  Run `npm test` and verify all test files pass.
- [ ] **Step 3: Start server daemon**
  Restart Habblaud on port 4747.
- [ ] **Step 4: Live Verification**
  - Verify `GET /api/snapshot` shows CEO room and CEO avatar.
  - Test `POST /api/ceo/decision` endpoint.
  - Verify browser UI at `http://127.0.0.1:4747`.
- [ ] **Step 5: Final Commit**
  `git commit -m "feat(ceo): complete executive CEO suite and artifact approval workflow"`
