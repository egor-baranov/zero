# Milestone 4 Architecture (No Monaco)

## Goals

Milestone 4 keeps the chat-first shell fixed and adds review/file surfaces without Monaco:
- ACP hosted in Electron main process
- renderer communicates only through preload APIs
- streamed updates and permission requests rendered inline in center chat
- workspace file tree + review panel as secondary UI surfaces

## Runtime Boundaries

### Main Process (`src/main`)

Responsibilities:
- create/configure `BrowserWindow`
- persist window bounds
- host ACP connection and session lifecycle
- own permission-request promise resolution
- expose ACP operations through IPC
- provide workspace file listing, reading, diff, and reveal operations

Key files:
- `main.ts`: app lifecycle, ACP event fanout to renderer windows
- `ipc/acp-ipc.ts`: ACP request handlers
- `services/acp/acp-service.ts`: `ClientSideConnection` wrapper and session methods
- `services/acp/mock-agent-script.ts`: runtime-generated local mock ACP subprocess script
- `ipc/shell-ipc.ts`: native Open Folder dialog
- `ipc/workspace-ipc.ts`: workspace file handlers
- `services/settings/settings-store.ts`: window state persistence
- `services/workspace/workspace-service.ts`: file system and git-diff helpers

### Preload (`src/preload`)

Responsibilities:
- typed bridge for shell + ACP methods
- typed bridge for workspace file operations
- event subscription channel for streamed ACP updates

Key files:
- `api.ts`
- `index.ts`

### Renderer (`src/renderer`)

Responsibilities:
- maintain shell UI composition
- track workspace/thread shell state
- map threads to ACP sessions
- render ACP session timeline
- surface permission decisions
- open workspace files from file tree/transcript
- render file review panel (diff + content)

Key areas:
- `store/use-shell-state.ts`: workspaces, threads, persisted UI state
- `store/use-acp.ts`: ACP initialize/new/load/prompt/cancel orchestration and timeline reduction
- `features/transcript`: inline rendering of streamed message chunks, plan cards, tool cards
- `features/composer`: submit + cancel controls bound to ACP prompt lifecycle
- `features/permissions`: permission modal bound to `session/request_permission`
- `features/shell`: end-to-end orchestration without changing layout structure
- `features/workspace/file-tree-dialog.tsx`: file search/pick surface
- `features/workspace/review-panel.tsx`: right-side file review surface

### Shared (`src/shared`)

Responsibilities:
- IPC channels and cross-process ACP payload types

Key files:
- `contracts/ipc.ts`
- `types/acp.ts`
- `types/preload.ts`
- `types/settings.ts`
- `types/workspace.ts`

## ACP Flow

1. Renderer ensures ACP initialization via preload (`acpInitialize`).
2. Renderer ensures a session for selected thread (`session/new`, optionally `session/load` when supported).
3. Composer sends user prompt (`session/prompt`).
4. Main receives `session/update` notifications and forwards them to renderer.
5. If agent sends `session/request_permission`, main emits permission event and awaits renderer response.
6. Renderer approves/rejects, main resolves pending permission request.
7. Renderer can cancel an in-flight prompt (`session/cancel`).

## Persistence

- main process:
  - `windowBounds` in `settings.json`
- renderer:
  - sidebar width (`zeroade.sidebar.width`)
  - shell state (`zeroade.shell.state.v2`)
  - thread-session ACP map (`zeroade.acp.thread-sessions.v1`)

## Deferred (Next Milestones)

- Monaco editor integration
- full IDE behavior (persistent file tree pane, richer diffs, edit/save flows)
- commit UX beyond current scaffold actions
