# AGENTS.md

Guide for autonomous coding agents working in this repository.

## Repo Overview
- `server/` Go control API server (REST + SQLite + LiveKit SDK + embedded SPA)
- `web/` React + TypeScript + Vite + Tailwind SPA
- `deploy/` LiveKit/Ingress configs
- `run.sh` local dev orchestrator (Redis + LiveKit + Ingress + server + web)

## Cursor / Copilot Rules
- No `.cursor/rules/`, `.cursorrules`, or `.github/copilot-instructions.md` found in this repo.

## Build, Lint, Test Commands

### Top-level (local dev)
- Start everything: `./run.sh`
- Infra only: `./run.sh --infra`
- Server only: `./run.sh --server`
- Frontend only: `./run.sh --frontend`

### Server (Go)
Run from `server/`:
- Build: `go build ./cmd/server/`
- Lint (basic): `go vet ./...`
- Test (all): `go test ./...`
- Test (single package): `go test ./internal/service`
- Test (single test name): `go test ./internal/service -run TestName`
- Test (single test name, all packages): `go test ./... -run TestName`

Notes:
- The server embeds the built SPA at `server/cmd/server/dist/`.
- For a full production build, build the web app and copy `web/dist/` to `server/cmd/server/dist/`.

### Web (React + Vite)
Run from `web/`:
- Install: `npm install`
- Dev server: `npm run dev`
- Build (typecheck + build): `npm run build`
- Preview prod build: `npm run preview`
- Typecheck only: `npx tsc --noEmit`

Notes:
- No dedicated lint/test scripts are defined in `web/package.json`.

## Code Style Guidelines

### Go (server/)
- Formatting: run `gofmt` (Go standard formatting). Use tabs, not spaces.
- Imports: group stdlib, third-party, and local imports with blank lines (goimports style).
- Naming:
  - Packages: short, lowercase, no underscores.
  - Types/structs: `PascalCase`.
  - Vars/fields: `camelCase` (exported `PascalCase`).
  - Errors: exported sentinel errors in `internal/domain/errors.go` (e.g., `ErrRoomNotFound`).
- Error handling:
  - Wrap errors with context using `fmt.Errorf("action: %w", err)`.
  - Prefer sentinel errors for domain conditions and check with `errors.Is`.
  - Return early on error; avoid deep nesting.
- Context:
  - Service methods accept `context.Context` as first arg and pass it to repositories.
  - Use `r.Context()` in HTTP handlers.
- API layer:
  - Use `api.DecodeJSON` + `api.WriteJSON`/`api.WriteError` for request/response.
  - Validate inputs and return appropriate HTTP status + code/message.
  - Prefer constant-time compare for secrets (`crypto/subtle`).
- JSON:
  - Struct tags use snake_case (e.g., `room_id`).
  - Timestamps formatted with RFC3339 via `api.FormatTime`.
- Logging:
  - Use structured logging with `log/slog` in middleware; keep keys stable.

### TypeScript/React (web/)
- Formatting:
  - Use single quotes (`'`), no semicolons.
  - 2-space indentation (default Vite/TS style in this repo).
- Types:
  - Shared API types live in `web/src/types/index.ts`.
  - Use `interface` for object shapes, `type` for unions.
  - JSON payloads use snake_case keys to match server responses.
- React:
  - Use functional components and hooks.
  - State is managed with Zustand stores in `web/src/stores/`.
- API client:
  - Centralize API calls in `web/src/services/api.ts`.
  - Throw on non-OK responses with a descriptive message.
- Imports:
  - Prefer type-only imports with `import type`.
  - Group external imports first, then local.
- Tailwind:
  - Tailwind is configured in `web/tailwind.config.js`.
  - Keep class lists readable; extract complex UI into components.

## Project Structure Conventions

### Server layering
- `internal/api/handlers`: HTTP handlers (validation, status mapping, JSON I/O)
- `internal/service`: business logic and orchestration
- `internal/repository`: persistence interfaces and SQLite implementations
- `internal/domain`: core domain models and sentinel errors

### Web layering
- `src/components`: UI components
- `src/hooks`: LiveKit + voice/chat logic
- `src/stores`: Zustand state containers
- `src/services`: API client functions
- `src/types`: shared type definitions

## Security Policy

This project maintains a security policy in [SECURITY.md](./SECURITY.md).
All AI coding agents MUST read and follow SECURITY.md before making changes.
It contains:

- Threat model and trust boundaries
- Attack surface documentation for all API endpoints
- Secure coding guidelines specific to Go + React/TypeScript stack
- Hard constraints and forbidden patterns for AI agents
- Vulnerability reporting procedures
- Known risks and accepted trade-offs

Any code contribution that violates the rules in SECURITY.md will be rejected.

## Working Safely
- Do not commit secrets (env files, tokens).
- When editing server responses or request bodies, update types in `web/src/types/index.ts`.
- Keep API field names in sync between Go JSON tags and TS types.
- Follow the security policy in [SECURITY.md](./SECURITY.md).

## Useful References
- Local dev: `./run.sh` (or selective flags)
- Server main entry: `server/cmd/server/main.go`
- REST handlers: `server/internal/api/handlers/`
- Frontend entry: `web/src/main.tsx`
