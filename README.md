# Corvoicer

Voice and video chat platform built around [LiveKit](https://livekit.io/). A Go control-api server manages rooms, participants, streams, and chat messages, serving a web-based SPA for the user interface.

## Architecture

```
deploy/                  Configuration files for LiveKit and Ingress
  config/                  livekit.yaml, ingress.yaml
server/                  Go control-api server (REST, SQLite, LiveKit SDK, embedded SPA)
  cmd/server/              Main entry point with embedded migrations
  internal/                API handlers, services, repositories
web/                     React + TypeScript + Tailwind CSS (Vite)
```

The **server** exposes a JSON REST API and serves the built SPA at the root path. The **web** frontend talks to the server over same-origin HTTP and connects directly to LiveKit for real-time audio/video.

## Prerequisites

| Tool                                                  | Version | Purpose                          |
| ----------------------------------------------------- | ------- | -------------------------------- |
| [Redis](https://redis.io/)                            | 7+      | In-memory data store             |
| [LiveKit Server](https://docs.livekit.io/)            | 1.8+    | Real-time SFU                    |
| [LiveKit Ingress](https://github.com/livekit/ingress) | 1.4+    | Stream ingest (WHIP)             |
| [Go](https://go.dev/dl/)                              | 1.23+   | Server                           |
| [Node.js](https://nodejs.org/)                        | 18+     | Frontend build (npm)             |
| netcat (nc)                                           | any     | Used by `run.sh` for port checks |

**For production deployment**, see [DEPLOY.md](DEPLOY.md) for detailed server setup instructions.

## Quick Start

### Installation (macOS)

```bash
brew install redis livekit go node
```

For Ingress, build from source (see [DEPLOY.md](DEPLOY.md) section 5).

### Installation (Linux)

```bash
# Ubuntu/Debian
sudo apt install redis-server golang nodejs

# LiveKit Server
curl -sSL https://get.livekit.io | bash
```

For Ingress, build from source (see [DEPLOY.md](DEPLOY.md) section 5).

### Local Development

Start all services:

```bash
./run.sh
```

This will:

1. Start Redis locally
2. Start LiveKit Server and Ingress
3. Build and run the Go server
4. Start the Vite frontend dev server with hot reload

Access at **http://localhost:5173**

Press `Ctrl+C` to stop all services.

#### Selective startup

```bash
./run.sh --infra      # Infrastructure only (Redis, LiveKit, Ingress)
./run.sh --server     # Server only (requires infrastructure running)
./run.sh --frontend   # Frontend dev server only
./run.sh --help       # Show help
```

#### Environment Variables

The script uses sensible defaults, but you can override them:

```bash
SERVER_PORT=9000 LOG_LEVEL=info ./run.sh
```

| Variable              | Default                                | Description                         |
| --------------------- | -------------------------------------- | ----------------------------------- |
| `SERVER_PORT`         | `8080`                                 | Control API port                    |
| `DATABASE_PATH`       | `./server/corvoicer.db`                | SQLite database path                |
| `LIVEKIT_HOST`        | `ws://127.0.0.1:7880`                  | LiveKit WebSocket URL               |
| `LIVEKIT_API_KEY`     | `devkey`                               | LiveKit API key                     |
| `LIVEKIT_API_SECRET`  | `secret-dev-key-min-32-characters!!`   | LiveKit API secret                  |
| `INVITE_TOKEN_SECRET` | `invite-secret-dev-key-min-32-chars!!` | JWT secret for invites (min 32)     |
| `ADMIN_TOKEN`         | `admin-dev-token-12345`                | Admin token for room creation       |
| `USE_HTTPS`           | `true`                                 | Enable HTTPS for dev server         |
| `LOG_LEVEL`           | `debug`                                | Log level: debug, info, warn, error |

### Manual Server Setup

If you prefer running the server manually without `run.sh`:

```bash
cd server

export LIVEKIT_HOST="ws://127.0.0.1:7880"
export LIVEKIT_API_KEY="devkey"
export LIVEKIT_API_SECRET="secret-dev-key-min-32-characters!!"
export INVITE_TOKEN_SECRET="invite-secret-dev-key-min-32-chars!!"
export ADMIN_TOKEN="admin-dev-token-12345"
export LOG_LEVEL="debug"

go build ./cmd/server/
./server
```

### Web Frontend

For development with hot reload, run the Vite dev server:

```bash
cd web
npm install
npm run dev
```

The dev server runs on `http://localhost:5173` and proxies API requests to `http://localhost:8080`.

For a production build (embedded into the server binary):

```bash
cd web
npm run build
# Copy dist/ into server embed location
cp -r dist/ ../server/cmd/server/dist/
```

## Server Configuration

All configuration is via environment variables:

| Variable              | Default                              | Description                                     |
| --------------------- | ------------------------------------ | ----------------------------------------------- |
| `SERVER_PORT`         | `8080`                               | HTTP listen port                                |
| `BIND_ADDR`           | `127.0.0.1`                          | Bind address                                    |
| `DATABASE_PATH`       | `./corvoicer.db`                     | SQLite database file path                       |
| `LIVEKIT_HOST`        | `ws://127.0.0.1:7880`                | LiveKit WebSocket URL                           |
| `LIVEKIT_API_KEY`     | `devkey`                             | LiveKit API key                                 |
| `LIVEKIT_API_SECRET`  | `secret-dev-key-min-32-characters!!` | LiveKit API secret                              |
| `WHIP_BASE_URL`       | _(empty)_                            | WHIP endpoint URL (for OBS streaming)           |
| `INVITE_TOKEN_SECRET` | _(required)_                         | Secret for signing invite tokens (min 32 bytes) |
| `ADMIN_TOKEN`         | _(required)_                         | Admin token for room creation (min 8 chars)     |
| `ROOM_DEFAULT_TTL`    | `24h`                                | Room time-to-live (Go duration format)          |
| `LOG_LEVEL`           | `info`                               | Log level: `debug`, `info`, `warn`, `error`     |
| `TLS_CERT_PATH`       | _(empty)_                            | Path to TLS certificate (for HTTPS)             |
| `TLS_KEY_PATH`        | _(empty)_                            | Path to TLS key (for HTTPS)                     |

## Network Architecture

### Development (Localhost)

All services run on `127.0.0.1`. STUN is disabled in [`deploy/config/livekit.yaml`](deploy/config/livekit.yaml) and [`deploy/config/ingress.yaml`](deploy/config/ingress.yaml) to avoid ICE gathering timeouts on systems with broken IPv6 routing.

### Production

For production deployment with a dedicated public IPv4 address, see [DEPLOY.md](DEPLOY.md) which covers:

- Server requirements and preparation
- Redis, LiveKit Server, and Ingress installation
- SSL certificates with Let's Encrypt
- Nginx reverse proxy configuration
- systemd service setup
- Firewall configuration

## API Reference

Base URL: `http://localhost:8080`

### Health

| Method | Path      | Description               |
| ------ | --------- | ------------------------- |
| GET    | `/health` | Returns `{"status":"ok"}` |

### Rooms

| Method | Path                            | Description                                                             |
| ------ | ------------------------------- | ----------------------------------------------------------------------- |
| POST   | `/api/v1/rooms`                 | Create a room. Body: `{"owner_display_name": "..."}`                    |
| POST   | `/api/v1/rooms/join`            | Join via invite. Body: `{"invite_token": "...", "display_name": "..."}` |
| GET    | `/api/v1/rooms/{room_id}`       | Get room info                                                           |
| POST   | `/api/v1/rooms/{room_id}/leave` | Leave room. Body: `{"participant_session_id": "..."}`                   |

### Streams

| Method | Path                                   | Description                                                                           |
| ------ | -------------------------------------- | ------------------------------------------------------------------------------------- |
| POST   | `/api/v1/rooms/{room_id}/stream/start` | Start streaming. Body: `{"participant_session_id": "..."}`                            |
| POST   | `/api/v1/rooms/{room_id}/stream/stop`  | Stop streaming. Body: `{"participant_session_id": "...", "stream_session_id": "..."}` |

### Messages

| Method | Path                                                 | Description                                                                   |
| ------ | ---------------------------------------------------- | ----------------------------------------------------------------------------- |
| POST   | `/api/v1/rooms/{room_id}/messages`                   | Send message. Body: `{"participant_session_id", "client_message_id", "text"}` |
| GET    | `/api/v1/rooms/{room_id}/messages?limit=N&before=ID` | Get chat history (max 100 per page)                                           |

## Development

### Server

Run with debug logging:

```bash
cd server
export LOG_LEVEL="debug"
export INVITE_TOKEN_SECRET="invite-secret-dev-key-min-32-chars!!"
export ADMIN_TOKEN="admin-dev-token-12345"
export LIVEKIT_API_SECRET="secret-dev-key-min-32-characters!!"
go build ./cmd/server/ && ./server 2>&1 | jq .
```

Lint:

```bash
cd server
go vet ./...
```

### Frontend

Start the Vite dev server:

```bash
cd web
npm run dev
```

Typecheck:

```bash
cd web
npx tsc --noEmit
```

### Testing the API

```bash
# Health check
curl http://localhost:8080/health

# Create a room (requires ADMIN_TOKEN header)
curl -X POST http://localhost:8080/api/v1/rooms \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_ADMIN_TOKEN' \
  -d '{"owner_display_name": "Alice"}'

# Join a room (use invite_token from the create response)
curl -X POST http://localhost:8080/api/v1/rooms/join \
  -H 'Content-Type: application/json' \
  -d '{"invite_token": "<token>", "display_name": "Bob"}'
```

## Database

The server uses SQLite. The schema is applied automatically on startup via embedded migrations (`server/cmd/server/migrations/`).

Tables: `rooms`, `participant_sessions`, `stream_sessions`, `chat_messages`.

A background cleanup job runs every 5 minutes to expire old rooms and purge chat messages older than the configured retention period (30 days by default).

## Commands Reference

### Development

```bash
./run.sh                   # Start all services
./run.sh --infra           # Infrastructure only (Redis + LiveKit + Ingress)
./run.sh --server          # Server only
./run.sh --frontend        # Frontend dev server only
```

### Server

```bash
cd server
go build ./cmd/server/     # Build
./server                   # Run (requires env vars)
go vet ./...               # Lint
```

### Frontend

```bash
cd web
npm install                # Install dependencies
npm run dev                # Dev server with hot reload
npm run build              # Production build
npx tsc --noEmit           # Typecheck only
```
