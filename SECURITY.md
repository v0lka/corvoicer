# Security Policy

## Supported Versions

The project is in early development. Currently only the `main` branch receives security updates.
No tagged releases or versioned security support exists yet.

| Version | Supported          |
| ------- | ------------------ |
| main    | :white_check_mark: |
| < main  | :x:                |

## Reporting a Vulnerability

**Do NOT open public GitHub issues for security vulnerabilities.**

If you discover a security vulnerability, please report it privately to the project maintainer.

**Response SLA (best effort):**

- Acknowledgment: within 72 hours
- Triage & severity assessment: within 7 business days
- Fix timeline: Critical — 14 days, High — 30 days, Medium — 90 days

**Disclosure policy:** Coordinated disclosure. We request a 90-day embargo
before public disclosure. We credit reporters in release notes unless they
prefer anonymity.

**Bug bounty:** Not applicable at this stage.

---

## Threat Model

### Assets

| Asset                            | Sensitivity | Description                                                                                            |
| -------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------ |
| INVITE_TOKEN_SECRET              | Critical    | HMAC-SHA256 signing key for invite tokens. Compromise allows forging valid invite tokens.              |
| ADMIN_TOKEN                      | Critical    | Shared secret for room creation. Compromise allows unauthorized room creation.                         |
| LIVEKIT_API_SECRET               | Critical    | LiveKit server API secret. Compromise allows forging LiveKit JWT tokens and controlling LiveKit rooms. |
| LiveKit JWT access tokens        | High        | Generated per-participant, 1-hour validity. Grant room join and video capabilities.                    |
| Invite tokens                    | High        | Signed tokens granting room access. Transiently present in URLs (corvoicer:// scheme).                 |
| Participant session IDs          | High        | UUIDs used as bearer-equivalent credentials for rejoin, leave, stream control, and chat.               |
| Chat messages                    | High        | User-generated text persisted in SQLite. May contain PII or sensitive discussion.                      |
| WHIP stream keys / bearer tokens | High        | Tokens used by OBS/broadcasters to push video streams via WHIP ingress.                                |
| Display names                    | Medium      | User-chosen names, up to 50 characters. Low PII risk.                                                  |
| Room IDs                         | Medium      | UUIDs identifying rooms. Exposed in API responses and URLs.                                            |
| Application configuration        | Medium      | Internal IPs, ports, DB path. Not directly exposed but visible in deployment configs.                  |
| Access logs (remote_addr)        | Medium      | Request logs include client IP addresses.                                                              |

### Threat Actors

- **Opportunistic attacker** — Automated scanners probing for open endpoints, weak authentication, known vulnerabilities.
- **Malicious participant** — A user who has joined a room legitimately and attempts to escalate privileges (impersonate owner, hijack stream, spam chat).
- **Passive observer** — An attacker who obtains a valid participant session ID or room ID and reads room info, chat history, or attempts rejoin.
- **Compromised supply chain** — A malicious or vulnerable dependency in the Go module or npm dependency tree.
- **AI coding agent (misconfigured)** — An autonomous coding agent with insufficient security constraints introducing vulnerabilities.

### Attack Surface

#### REST API Endpoints (Go server, `server/internal/api/handlers/`)

| Endpoint                                                                  | Auth                                     | Method                           | Risk                                                                                                                  |
| ------------------------------------------------------------------------- | ---------------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `GET /health`                                                             | None                                     | Any                              | Low — returns static JSON.                                                                                            |
| `POST /api/v1/auth/validate-admin-token`                                  | None (validates admin token payload)     | Public                           | Medium — token oracle; uses constant-time compare but reveals validity. DoS risk without rate limiting.               |
| `POST /api/v1/rooms`                                                      | Admin token (constant-time)              | Owner only                       | Medium — room creation with admin token.                                                                              |
| `POST /api/v1/rooms/join`                                                 | Invite token (HMAC-signed)               | Member                           | Medium — room join with invite token.                                                                                 |
| `POST /api/v1/rooms/rejoin`                                               | Participant session ID                   | Rejoining participant            | **High** — no additional authentication beyond knowing a UUID.                                                        |
| `GET /api/v1/rooms/{room_id}`                                             | **None**                                 | Public                           | **High** — exposes room status, participant count, and active broadcaster session ID to anyone who knows the room ID. |
| `POST /api/v1/rooms/{room_id}/leave`                                      | Participant session ID                   | Leaving participant              | Medium.                                                                                                               |
| `POST /api/v1/rooms/{room_id}/participants/{participant_session_id}/mute` | Owner session ID check                   | Owner only                       | Medium — owner mutes/unmutes participants.                                                                            |
| `POST /api/v1/rooms/{room_id}/stream/start`                               | Owner session ID check                   | Owner only                       | Medium — creates WHIP ingress.                                                                                        |
| `POST /api/v1/rooms/{room_id}/stream/stop`                                | Broadcaster session ID check             | Broadcaster only                 | Medium — stops stream.                                                                                                |
| `POST /api/v1/rooms/{room_id}/messages`                                   | Participant session ID (no verification) | Any valid participant session ID | **High** — anyone with a valid session ID can post messages to a room.                                                |
| `GET /api/v1/rooms/{room_id}/messages`                                    | **None**                                 | Public                           | **High** — chat history is publicly readable by anyone who knows the room ID.                                         |

#### Real-time Channels

| Service                                     | Exposure                        | Notes                                                        |
| ------------------------------------------- | ------------------------------- | ------------------------------------------------------------ |
| LiveKit WebSocket (`/livekit` on port 7880) | All participants with valid JWT | JWT signed by server, 1-hour validity. No origin validation. |
| LiveKit WHIP Ingress (port 7985)            | Broadcaster with stream key     | Stream key is the bearer token from WHIP ingress creation.   |

#### Other Entry Points

- Environment variables read at startup (`server/internal/config/config.go:34-75`)
- CLI arguments: none; all config via env vars
- CI/CD: no GitHub Actions or CI/CD pipelines configured
- File system: SQLite database file (`DATABASE_PATH`, default `./corvoicer.db`)

### Trust Boundaries

```
┌──────────────────────────────────────────────────────────────┐
│  Internet / LAN (Untrusted)                                  │
│  - Browsers, OBS clients, scanners                           │
└──────────┬──────────────────────────────────────┬────────────┘
           │ HTTPS (TLS 1.2+)                     │ WebSocket / WHIP
           │ Nginx reverse proxy                  │ (LiveKit native)
┌──────────▼──────────────────────────────────────▼────────────┐
│  Edge / DMZ (Nginx in production, Vite proxy in dev)        │
│  - TLS termination, security headers                        │
└──────────────────────┬──────────────────────────────────────┘
                       │ HTTP reverse proxy / same-origin
┌──────────────────────▼──────────────────────────────────────┐
│  Corvoicer Control API Server (Go)                          │
│  - REST handlers: authz checks, input validation            │
│  - LiveKit SDK: token generation, ingress control           │
│  - SPA serving: embedded static files                      │
└──────────────────────┬──────────────┬───────────────────────┘
                       │ SQLite       │ LiveKit API (internal)
                       │ (WAL mode,   │
                       │ foreign keys)│
┌──────────────────────▼──────────────▼───────────────────────┐
│  Data Layer                                                 │
│  - SQLite: rooms, participants, streams, messages           │
│  - LiveKit Server + Redis: real-time media & signaling     │
└─────────────────────────────────────────────────────────────┘
```

### Known Risks & Accepted Trade-offs

| Risk                                                                | Severity | Rationale / Mitigation                                                                                                                                                                          |
| ------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No rate limiting on any endpoint                                    | High     | Accepted for MVP. Enables DoS via repeated auth attempts, message spam, room creation. Tracked as a priority hardening item.                                                                    |
| CORS allows all origins (`*`)                                       | Medium   | Enables cross-origin requests from any domain. `server/internal/api/middleware/cors.go:7`. Acceptable for local dev; must be restricted in production.                                          |
| Participant session IDs are UUIDs with no additional authentication | High     | Rejoin, leave, stream control, and chat posting rely solely on knowing a session ID. If a UUID leaks (e.g., browser devtools, logs, shared URLs), an attacker can impersonate that participant. |
| Room info and chat history are publicly accessible                  | Medium   | Any attacker who obtains a room ID can enumerate room status, participant counts, and chat history.                                                                                             |
| No request body size limits                                         | Medium   | The Go `http.Server` does not enforce body size limits on POST endpoints. Large payloads may cause memory pressure.                                                                             |
| localStorage persists participant session data                      | Medium   | `web/src/stores/roomStore.ts:29-35`. Any script execution in the SPA context (XSS) can read session data and join/leave rooms.                                                                  |
| Default LiveKit dev secrets in `run.sh`                             | Low      | `run.sh` uses `devkey`/`devsecret` for local development only. NOT for production.                                                                                                              |
| No CSRF protection                                                  | Low      | The API uses JSON bodies (not form submissions), which is inherently CSRF-resistant, but a defense-in-depth measure (CSRF token or SameSite cookies) is advisable.                              |
| Logging includes client IP addresses                                | Low      | `server/internal/api/middleware/logger.go:18` logs `remote` IP. Acceptable for operational purposes but note under privacy regulations.                                                         |
| Single SQLite connection (`SetMaxOpenConns(1)`)                     | Low      | Acceptable for single-binary deployment but limits concurrent write throughput. Mitigated by WAL mode.                                                                                          |

---

## Security Architecture

### Authentication & Authorization

**Room creation** — Requires `admin_token` in request body, compared using `crypto/subtle.ConstantTimeCompare` to prevent timing attacks (`server/internal/api/handlers/rooms.go:64`). The admin token must be at least 8 characters (`server/internal/config/config.go:70`).

**Room joining** — Requires an invite token generated by the server. Tokens are HMAC-SHA256 signed with the `INVITE_TOKEN_SECRET` and embed an expiry timestamp. Token hashes are stored in the database, not raw tokens (`server/internal/service/invite.go:23-29`). The secret must be at least 32 bytes (`server/internal/config/config.go:63`).

**Participant identification** — After joining, participants receive a UUID session ID used for all subsequent operations (rejoin, leave, stream control, chat). No additional Bearer token or session cookie is enforced.

**Authorization model** — Two roles: `owner` and `member` (`server/internal/domain/participant.go`). The owner can mute other participants and start streams. The broadcaster (owner who started the stream) can stop it.

**LiveKit authentication** — The server generates LiveKit JWT access tokens with 1-hour validity using the LiveKit API secret (`server/internal/livekit/tokens.go:20-33`). Tokens grant room join and video capabilities.

### Data Protection

**Encryption in transit** — The server supports HTTPS when `TLS_CERT_PATH` and `TLS_KEY_PATH` are configured (`server/cmd/server/main.go:131-137`). In production, Nginx handles TLS termination with Let's Encrypt certificates (see `DEPLOY.md`).

**Encryption at rest** — SQLite database is stored as a plain file. No field-level or file-level encryption is implemented. Secrets (invite token hashes, not tokens themselves) live in the same SQLite file.

**PII handling** — Display names (up to 50 chars) and chat messages are the only user-generated content persisted. There is no automated anonymization or pseudonymization.

**Data retention** — Rooms and chat messages are subject to automatic cleanup via background goroutine (`server/internal/repository/sqlite/cleanup.go`):

- Expired rooms (past `expires_at`) are deleted every 5 minutes.
- Chat messages older than `ChatRetentionDays` (default 30 days) are deleted.
- Chat messages per room are capped at `ChatMaxPerRoom` (default 5000).

**Backup** — The production deployment guide (`DEPLOY.md`) recommends backing up the SQLite database file.

### Secret Management

All secrets are provided via environment variables at startup. No secret manager integration (Vault, KMS) is currently used.

| Secret                   | Env Var               | Min Length   | Notes                                 |
| ------------------------ | --------------------- | ------------ | ------------------------------------- |
| Invite token signing key | `INVITE_TOKEN_SECRET` | 32 bytes     | Used for HMAC-SHA256. Must be random. |
| Admin token              | `ADMIN_TOKEN`         | 8 characters | Shared secret for room creation.      |
| LiveKit API key          | `LIVEKIT_API_KEY`     | —            | LiveKit server API key.               |
| LiveKit API secret       | `LIVEKIT_API_SECRET`  | —            | LiveKit server API secret.            |

Secret generation guidance (from `DEPLOY.md`):

```bash
openssl rand -base64 32   # INVITE_TOKEN_SECRET
openssl rand -base64 32   # ADMIN_TOKEN
openssl rand -base64 32   # LIVEKIT_API_KEY / LIVEKIT_API_SECRET
```

**Secrets MUST NEVER appear in:**

- Source code (enforced by `.gitignore` for `.env`)
- Log output
- Error messages returned to clients
- Commit messages or pull request descriptions
- CI/CD output

### Dependency Management

**Go (**`server/go.mod`**):** 4 direct dependencies, 143 transitive. `go.sum` provides checksum verification.

Direct dependencies:

- `github.com/google/uuid` v1.6.0 — UUID generation
- `github.com/livekit/protocol` v1.9.7 — LiveKit protocol definitions
- `github.com/livekit/server-sdk-go` v1.1.8 — LiveKit server SDK
- `modernc.org/sqlite` v1.46.1 — Pure-Go SQLite driver

**npm (**`web/package.json`**):** 7 direct dependencies (React, LiveKit client, Zustand, Krisp noise filter, emoji-mart) + Vite toolchain devDeps. `package-lock.json` provides version pinning.

**Known issues:**

- npm audit: 1 moderate vulnerability in `postcss` (transitive via Tailwind CSS). Fix requires Tailwind v4 upgrade.
- Go: `govulncheck` should be run regularly (see setup below).

**Missing capabilities:**

- No automated dependency scanning (Dependabot, Renovate, Snyk) is configured.
- No regular `npm audit` or `govulncheck` runs in CI.
- No process for evaluating new dependencies.

**Recommended setup:**

```bash
# Go vulnerability scanning
cd server && go run golang.org/x/vuln/cmd/govulncheck@latest ./...

# npm vulnerability scanning
cd web && npm audit
```

### Logging, Monitoring & Incident Response

**Logging** — The server uses structured JSON logging via `log/slog` (`server/cmd/server/main.go:42-45`). The logger middleware records: HTTP method, path, status code, duration, and remote address (`server/internal/api/middleware/logger.go:14-20`). The panic recovery middleware logs stack traces on crash (`server/internal/api/middleware/recovery.go:13-19`).

**What is logged:**

- All HTTP requests (method, path, status, duration, remote IP)
- Server startup and shutdown events
- Database open/ping status
- Panic recovery with full stack traces
- Cleanup operations (expired room/message deletions)
- Stream start errors with room ID context

**What MUST NOT be logged:**

- Secrets (admin token, invite token secret, LiveKit API secret)
- Invite tokens
- LiveKit JWT tokens
- WHIP stream keys
- Chat message text content
- Full request bodies

**Monitoring —** No automated monitoring, anomaly detection, or alerting is configured out of the box. The `/health` endpoint is available for uptime checks.

**Incident response —** No formal incident response plan exists. In case of a security incident:

1. Stop affected services.
2. Rotate all secrets (`INVITE_TOKEN_SECRET`, `ADMIN_TOKEN`, `LIVEKIT_API_SECRET`).
3. Preserve logs and database files for forensic analysis.
4. Identify the attack vector and close it.
5. Restore from backup if data integrity is compromised.

---

## Secure Coding Guidelines

These guidelines apply to ALL contributors: human developers, code reviewers, and AI/LLM coding agents.

### Input Validation

- Validate all external input at API boundaries. Use `api.DecodeJSON` which sets `DisallowUnknownFields` (`server/internal/api/request.go:8-12`).
- Display names: 1–50 characters, validated in handler (`server/internal/api/handlers/rooms.go:59-61`, `server/internal/api/handlers/rooms.go:117-119`).
- Message text: 1–2000 characters, validated in service layer (`server/internal/service/message.go:28-29`).
- Chat message limit: max 100 per query, enforced in handler (`server/internal/api/handlers/messages.go:72`).
- Admin token: minimum 8 characters at config load (`server/internal/config/config.go:70`).
- Invite token secret: minimum 32 bytes at config load (`server/internal/config/config.go:63`).
- Room default TTL: validates duration format, defaults to 24h (`server/internal/config/config.go:54-57`).
- Never trust client-side validation alone.
- Use allowlists over denylists wherever possible.

### Output Encoding & Injection Prevention

- **SQL:** All database queries use parameterized statements with `?` placeholders. NEVER construct SQL via string concatenation, `fmt.Sprintf`, or template interpolation.
- **XSS:** The SPA uses React which auto-escapes JSX content by default. NEVER use `dangerouslySetInnerHTML`.
- **JSON responses:** Use `api.WriteJSON` for all responses. Error messages returned to clients must not expose internal details.
- **URL path values:** `r.PathValue()` values are used in DB queries via parameterized statements only.

### Authentication & Session Security

- **Token comparison:** ALWAYS use `crypto/subtle.ConstantTimeCompare` for secret comparison — not `==` or `strings.EqualFold`.
- **Token generation:** Use HMAC-SHA256 for invite token signing (`server/internal/service/invite.go:79-83`). Include expiry timestamps in signed payloads.
- **Session IDs:** Participant session IDs are UUIDv4 from `github.com/google/uuid`. They serve as bearer-equivalent credentials. Future hardening should add a separate authentication mechanism.
- **LiveKit tokens:** Generated with 1-hour validity (`server/internal/livekit/tokens.go:30`). Grant minimum necessary capabilities (room join + video).
- **Invite tokens:** Signed with expiry. Token hash stored in DB, not the raw token.

### Cryptography

- Use Go standard library `crypto/*` packages. NEVER implement custom cryptographic algorithms.
- HMAC: Use `crypto/hmac` with SHA-256, NOT SHA-1 or MD5.
- Hashing: Use `crypto/sha256` for token hashing.
- Constant-time comparison: Use `crypto/subtle.ConstantTimeCompare` for secret comparison.
- Randomness: Use `crypto/rand` (via `google/uuid`) for ID generation.

### Error Handling & Logging

- **Client errors:** Use `api.WriteError` with appropriate HTTP status codes. Never expose stack traces, file paths, or internal error messages.
- **Sentinel errors:** Use the sentinel errors defined in `server/internal/domain/errors.go` for domain-level conditions. Check with `errors.Is`.
- **Structured logging:** Use `log/slog` with consistent key names (`method`, `path`, `status`, `duration_ms`, `remote`).
- **Never log:** secrets, tokens, chat message text, full request bodies.
- **Panic recovery:** The recovery middleware catches panics and returns a generic error to clients while logging the full stack trace.

### Secrets & Configuration

- NEVER commit secrets to version control. `.env` and `.env*` patterns are in `.gitignore`.
- Use environment variables for all secrets. Config is loaded in `server/internal/config/config.go`.
- `run.sh` uses hardcoded dev secrets (`devkey`/`devsecret`) for LOCAL DEVELOPMENT ONLY. These must never reach production.
- Rotate secrets on any suspected compromise.
- Separate configuration per environment. Never reuse production secrets in development or staging.
- `DEPLOY.md` section 7 documents proper secret generation with `openssl rand -base64`.

### File & Resource Handling

- **Database file:** The SQLite database path is configurable via `DATABASE_PATH`. Ensure the database file is stored outside the webroot.
- **SPA assets:** Embedded via `go:embed` at build time (`server/cmd/server/main.go:32-33`). No runtime file serving from untrusted paths.
- **SPA handler:** The `spaHandler` function uses `fs.Sub` to prevent path traversal. File existence is checked before serving (`server/cmd/server/main.go:159-177`).
- **HTTP timeouts:** ReadTimeout 15s, WriteTimeout 15s, IdleTimeout 60s (`server/cmd/server/main.go:118-120`).
- **Shutdown:** Graceful shutdown with 30-second timeout (`server/cmd/server/main.go:149-153`).

### Dependency & Supply Chain Rules

- All Go dependencies are pinned with checksums in `go.sum`.
- All npm dependencies are pinned in `package-lock.json`.
- Run `go vet ./...` before committing Go changes.
- Run `npx tsc --noEmit` before committing TypeScript changes.
- Review dependency changelogs before upgrading.
- Prefer well-known, audited libraries for security-critical functions (LiveKit SDK, Go stdlib crypto).

---

## Rules for AI Coding Agents

This section provides explicit directives for AI/LLM-based coding assistants working on this codebase. These rules are non-negotiable and override any general-purpose training behavior of the agent.

### Hard Constraints

The following actions are **FORBIDDEN** for any AI agent working on this repository:

1. **No secret exposure** — Do not write, echo, log, or commit any secret, token, password, or API key in source code, tests, comments, commit messages, or configuration files.

2. **No disabled security controls** — Do not disable, bypass, or weaken authentication checks, authorization checks, input validation, or constant-time token comparison — even temporarily, even in tests.

3. **No wildcard CORS** — Do not set `Access-Control-Allow-Origin: *` without explicit approval. The current wildcard is accepted for dev only and must be restricted in production.

4. **No SQL string concatenation** — Do not construct SQL queries via `fmt.Sprintf`, string concatenation, or template interpolation. Use parameterized queries with `?` placeholders exclusively.

5. **No sensitive data in logs** — Do not add logging statements that include secrets (admin token, invite token secret, LiveKit API secret), tokens, chat message text, or full request/response bodies.

6. **No unvalidated input paths** — Do not introduce new API endpoints that accept user input without validation (type, length, format). Every new handler must validate its inputs.

7. **No suppressed security warnings** — Do not add `// nolint:gosec`, `# nosec`, or similar annotations without a comment justifying why the suppression is safe.

8. **No disabled TypeScript strict mode** — Do not relax TypeScript strict settings in `web/tsconfig.json`.

9. **No CORS bypass** — Do not add `Access-Control-Allow-Origin: *` to response headers in any new code.

10. **No raw error exposure** — Do not return internal error messages, stack traces, or file paths to API clients. Use `api.WriteError` with appropriate error codes.

### Behavioral Guidelines for Agents

- **Ask before acting on security boundaries** — If a change involves authentication flows, permission models, cryptographic operations, or network exposure, request human review before applying.

- **Preserve existing security patterns** — When modifying code, identify and maintain existing security invariants: constant-time token comparison, input validation, parameterized queries.

- **Default to secure** — When multiple implementation options exist, choose the more secure one even if it requires more code.

- **Flag uncertainty** — If you are uncertain whether a change introduces a security risk, flag it explicitly in a comment or PR description.

- **Respect `.gitignore`** — Never suggest removing entries from `.gitignore` that protect secrets.

- **Keep types in sync** — When editing server request/response structs, update corresponding TypeScript types in `web/src/types/index.ts` and maintain snake_case JSON keys.

- **Test security-relevant changes** — When modifying security-critical code (auth, token handling, input validation), verify the security property holds (e.g., unauthenticated requests are rejected, invalid tokens fail, oversized inputs are rejected).

### Stack-Specific Rules

**Go (server/):**

- Use `crypto/subtle.ConstantTimeCompare` for all secret comparisons.
- Use `hmac.Equal` for HMAC comparison (already used in `server/internal/service/invite.go:66`).
- All database queries must use parameterized `?` placeholders.
- Wrap errors with context: `fmt.Errorf("action: %w", err)`.
- Context must be the first parameter of service and repository methods.

**TypeScript/React (web/):**

- Never use `dangerouslySetInnerHTML`.
- Never store secrets, tokens, or sensitive data in `localStorage` beyond the already-established session persistence.
- Never construct URL paths by direct string concatenation with user input.
- All API calls must go through the centralized `web/src/services/api.ts`.

---

## Security-Related Configuration Files

| File                               | Purpose                                                                 |
| ---------------------------------- | ----------------------------------------------------------------------- |
| `server/internal/config/config.go` | Environment variable loading, secret validation (min lengths), defaults |
| `web/vite.config.ts`               | Dev server proxy configuration (API → backend, LiveKit → WebSocket)     |
| `deploy/config/livekit.yaml`       | LiveKit server config (dev only)                                        |
| `deploy/config/ingress.yaml`       | LiveKit ingress config (dev only)                                       |
| `run.sh`                           | Local dev orchestrator with hardcoded dev secrets (dev only)            |
| `.gitignore`                       | Prevents committing `.env`, `.cert/`, `.db`, IDE directories            |

There are no automated security scanning tools configured (`gitleaks`, `trivy`, `dependabot`, etc.) at this stage.

---

## Revision History

| Date       | Author | Change                                                   |
| ---------- | ------ | -------------------------------------------------------- |
| 2026-05-21 | @v0lka | Initial security policy generated from codebase analysis |
