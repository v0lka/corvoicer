# Corvoicer Product Specification

## 1. Document Status

This document is the single source of truth for the product implementation.
It defines functional requirements, architecture, technology stack, constraints, interfaces, and data models.
Any decisions not covered by this document **must not** be made during implementation without an explicit change to this specification.

---

## 2. Product Purpose

A web application (SPA) for:

- Co-watching movies;
- Game streaming;
- Voice communication;
- Text communication.

The product is not a content publishing platform, does not implement a social network, and does not record streams.

Primary user flow:

1. One user creates a room.
2. Other users join via an invite.
3. One participant starts a stream.
4. All participants watch the same video stream.
5. All participants can communicate via voice and text chat.

Each room allows **exactly one active stream** at a time.

---

## 3. Fixed Product Decisions

### 3.1. Usage Model

The product operates as **invite-only rooms** with no registration and no persistent accounts.

Each room:

- Is created manually;
- Has a unique identifier;
- Has an invite token;
- Exists until explicitly terminated or until its TTL expires (default: **24 hours**, configurable via `ROOM_DEFAULT_TTL`);
- Supports up to **16 simultaneous participants**.

Each participant in a room has one of two stored roles:

- `owner` — room creator;
- `member` — regular participant.

A participant is considered the **active broadcaster** when they have a currently active stream session in that room. This is a derived state, not a stored role.

### 3.2. Stream Slot Constraint

There is **exactly one active stream slot** per room.

Rules:

- If no active stream exists, any connected participant may occupy the slot and start streaming;
- If the slot is taken, a second participant's attempt to start is rejected (`409 STREAM_SLOT_OCCUPIED`);
- The slot is freed immediately after the stream ends;
- If the broadcaster disconnects from the room, the slot is freed automatically.

### 3.3. Access Platform

The client application is a web SPA (Single Page Application) embedded in the Go `control-api` server via `go:embed`.

Users access it through a web browser on any OS:

- Windows
- macOS
- Linux

#### Viewer and Voice Mode

All platforms support via web browser:

- Joining a room;
- Watching the stream;
- Voice chat;
- Text chat.

#### Streaming Mode

Streaming is supported on all platforms (Windows, macOS, Linux).

To stream, the user uses their own installation of OBS Studio with WHIP output support. The application provides a WHIP URL and Bearer Token, which the user manually enters in OBS settings.

Capture configuration (game capture, window capture, display capture, system audio) is the user's responsibility in their own OBS.

### 3.4. Room Creation Access Control

Room creation is restricted by an **admin token**. The token is configured server-side via the `ADMIN_TOKEN` environment variable (minimum 8 characters, required).

Before creating a room, the UI validates the admin token via `POST /api/v1/auth/validate-admin-token`. Only after successful validation is the "Create Room" button shown. The admin token is submitted as part of the `POST /api/v1/rooms` request body.

Any user with the invite token can join a room without an admin token.

---

## 4. Fixed Technology Stack

### 4.1. Client

The client is a **web SPA (Single Page Application)** embedded in the Go `control-api` server via `go:embed`.

UI layer:

- **React**
- **TypeScript**
- **Tailwind CSS**
- **Vite** (build and dev server)

### 4.2. RTC / Rooms / Voice / Viewing

**Self-hosted LiveKit** is used for real-time communication.

LiveKit is used for:

- Connecting participants to a room;
- Voice chat;
- Delivering the video stream to viewers;
- Real-time chat message transport (built-in chat API).

LiveKit Server requires **Redis** as its internal coordination store (configured in `livekit.yaml`). Redis is a LiveKit infrastructure dependency, not used directly by the Control API.

### 4.3. Video Stream Ingest

**LiveKit Ingress** is used to receive streams.

The ingest protocol is fixed as:

- **WHIP only**

RTMP, RTMPS, and other ingest protocols are **not used**.

Transcoding is disabled: `BypassTranscoding: true` is set when creating WHIP ingress (equivalent to `enable_transcoding: false`).

### 4.4. Capture and Encoding on the Streamer Side

The streamer uses their **own external OBS Studio** installation for capture and encoding.

The application does not manage OBS and does not launch OBS as a child process. Instead:

- The application creates a WHIP ingress via LiveKit Ingress;
- The application displays the WHIP URL and Bearer Token in the UI;
- The user manually configures OBS for WHIP output with the provided parameters;
- The user starts the stream from OBS themselves.

### 4.5. NAT Traversal

**LiveKit's built-in STUN server** is used for NAT traversal.

A separate TURN server (coturn or otherwise) is not used.

**Development:** STUN is disabled in `deploy/config/livekit.yaml` and `deploy/config/ingress.yaml` to avoid ICE gathering timeouts on systems with broken IPv6 routing. Loopback candidates are enabled for localhost ICE.

**Production:** STUN is enabled for NAT traversal.

### 4.6. Control API

A custom Go backend is required.  
It serves:

- Embedded SPA frontend;
- Room creation (admin-token gated);
- Invite token issuance;
- LiveKit access token issuance;
- Ingress creation and deletion;
- Text chat history storage;
- Room metadata storage.

### 4.7. Persistent Storage

**SQLite** in single-node mode is used for the Control API.

The use of PostgreSQL, Redis (in the Control API), and other external databases is prohibited in the Control API layer.

The schema is applied automatically on startup via embedded migrations (`server/cmd/server/migrations/`).

---

## 5. Non-Functional Requirements

### 5.1. Latency

- Media stream from streamer to viewer: target **≤ 1500 ms** under normal connection;
- Voice chat: target **≤ 400 ms** end-to-end;
- Audio/video desynchronization between participants and the stream should be minimized by using WHIP as the ingest protocol.

### 5.2. Reliability

- A viewer's disconnect does not affect others.
- Loss of connection to LiveKit transitions the room to `DISCONNECTED` and initiates a controlled reconnect.
- When the ingress participant leaves (loss of ingest connection), the client detects this via LiveKit events and updates stream state.
- When the broadcaster leaves the room, the Control API automatically ends the active stream session and frees the slot.

### 5.3. Security

- All external endpoints operate over **TLS** in production.
- Only trusted TLS certificates are used for LiveKit.
- Self-signed certificates are not permitted.
- Invite tokens are signed by the server using HMAC-SHA256 and are opaque to the client. Format: `base64url(roomID:expiresUnix:hmacSignature)`.
- The `INVITE_TOKEN_SECRET` must be at least 32 bytes.
- The `ADMIN_TOKEN` must be at least 8 characters.
- LiveKit access tokens are valid for **1 hour**.

### 5.4. Permissions

The client application:

- Never requests camera access;
- Requests microphone access only when the user unmutes for the first time;
- Does not use browser-based screen share as a primary or fallback path.

---

## 6. System Architecture

### 6.1. Overview

The system consists of the following components:

#### On the client (web browser)

1. **SPA Frontend**
   
   - React + TypeScript + Tailwind CSS
   - Built via Vite into `dist/`
   - Embedded in Go server via `go:embed`
   - Room visual state
   - Stream management (display of WHIP credentials)
   - Chat
   - Voice controls
   - Status display
   - State managed via Zustand stores
   - Server interaction via REST API (`/api/v1/...`)

#### On the server

1. **Control API (Go)** — also serves the SPA frontend
2. **LiveKit** (with built-in STUN for NAT traversal; requires Redis)
3. **LiveKit Ingress**
4. **SQLite** (part of Control API)
5. **Redis** (required by LiveKit)

### 6.2. Fixed Media Path

The only permitted video stream path:

`User's external OBS → WHIP → LiveKit Ingress → LiveKit Room → viewers`

The only permitted voice path:

`participant → LiveKit Room → other participants`

The only permitted real-time text path:

`participant → LiveKit chat message → other participants`

The only permitted text history path:

`participant → Control API → SQLite`

### 6.3. Service Ports (Development)

| Service | Port | Protocol |
|---------|------|----------|
| Redis | 6379 | TCP |
| LiveKit Server | 7880 (HTTP), 7881 (TCP) | TCP |
| LiveKit Server RTC | 50000–50100 | UDP |
| LiveKit Ingress WHIP | 7985 | TCP |
| LiveKit Ingress RTC | 60000–60100 | UDP |
| Control API | 8080 | TCP |
| Frontend Dev Server | 5173 | TCP |

---

## 7. Architectural Constraints

### 7.1. External OBS

OBS Studio is not embedded and not managed by the application. The user uses their own OBS installation.

The application:

- Does not launch OBS;
- Does not connect to OBS via WebSocket;
- Does not configure scenes, sources, or output;
- Does not monitor the OBS process state.

Instead, the application provides a WHIP URL and Bearer Token, which the user manually uses in OBS output settings.

---

## 8. Functional Requirements

### 8.1. Room Creation

A user can create a new room only after providing a valid admin token.

When creating a room, the system must:

- Generate a `room_id` (UUID v4);
- Generate an `invite_token` (HMAC-SHA256 signed, base64url-encoded);
- Create a room record in SQLite with status `open`;
- Return the invite token to the user;
- Record the creator as `owner`.

The room is created in `open` status.

### 8.2. Joining a Room

To join a room, the user provides:

- `invite_token`
- `display_name` (1–50 characters)

The system must:

- Validate the invite token (signature and expiry);
- Check the room is `open` and not expired;
- Check participant count < 16;
- Create a participant session record;
- Generate a LiveKit access token (valid for 1 hour);
- Return connection data for the room.

### 8.3. Voice Chat

Voice chat is required for all participants.

Rules:

- Microphone is off by default;
- User manually enables the microphone;
- Camera is absent from the product;
- Publishing video tracks from clients through LiveKit is not used;
- Voice is published only as the participant's audio track.

### 8.4. Text Chat

Text chat is required for all participants.

Working model:

1. On joining, the client loads the last messages from Control API (no explicit limit in the current client implementation; default server behavior returns up to 100).
2. During the session, new messages are sent via **LiveKit's built-in chat API** (`sendChatMessage` / `RoomEvent.ChatMessage`).
3. In parallel, each outgoing message is persisted in SQLite via Control API.
4. If SQLite persistence fails, the message is delivered real-time but marked `not_persisted: true` in the UI.
5. Chat history is retained for **30 days**.
6. Maximum stored messages per room: **5000**.

### 8.5. Starting a Stream

A user can start a stream only if:

- They are already connected to the room;
- There is no active stream in the room.

After clicking "Start Stream", the system must:

1. Execute `stream/start` on the server.
2. Create a WHIP ingress in LiveKit Ingress (with `BypassTranscoding: true`).
3. Obtain WHIP connection parameters (URL and Bearer Token).
4. Display the WHIP URL and Bearer Token to the user.
5. Transition stream state to `AWAITING_STREAM`.
6. When the ingress participant (`stream:<room_id>`) appears in the LiveKit room, transition to `LIVE`.

### 8.6. Stopping a Stream

When stopping a stream, the system must:

1. Delete the ingress;
2. End the stream session in SQLite;
3. Free the stream slot (`active_stream_session_id = NULL`);
4. Transition stream state to `IDLE`.

### 8.7. Automatic Stream Termination

If one of the following events occurs:

- Loss of ingest connection (ingress participant left the room);
- Broadcaster disconnects from the room;
- Network loss on the streamer's client;

The system must:

- End the active stream;
- Free the slot;
- Transition state to `FAILED`;
- Show all participants that the stream has ended.

**Implementation note:** When the broadcaster calls `POST /api/v1/rooms/{room_id}/leave`, the Control API automatically calls `streams.End` and clears `active_stream_session_id`. Client-side stream failure detection (detecting ingress participant disconnection) transitions local state to `FAILED`.

---

## 9. Streaming Quality Recommendations

These parameters are advisory for users configuring OBS themselves.

### 9.1. Recommended Video Stream Parameters

- Video codec: **H.264**
- Audio codec: **Opus**
- Maximum resolution: **1920×1080**
- Maximum frame rate: **60 FPS**
- Keyframe interval: **2 seconds**

### 9.2. Audio

- Sample rate: `48000 Hz`
- Channels: `stereo`
- Target bitrate: `160 kbps`

### 9.3. Ingress Transcoding

For WHIP ingress:

- `BypassTranscoding: true` (equivalent to `enable_transcoding: false`)

Simulcast and multi-layer encoding on the LiveKit Ingress side are not used.
The product relies on minimizing latency, not server-side transcoding.

---

## 10. State Machines

### 10.1. Room State (client)

States:

- `NOT_CONNECTED`
- `CONNECTING`
- `CONNECTED`
- `DISCONNECTED`

Transitions:

- `NOT_CONNECTED → CONNECTING` — start of join/create flow
- `CONNECTING → CONNECTED` — after successfully joining the LiveKit room
- `CONNECTING → NOT_CONNECTED` — on failure
- `CONNECTED → DISCONNECTED` — on connection loss
- `DISCONNECTED → CONNECTING` — on reconnect (via LiveKit's built-in reconnect logic)
- `DISCONNECTED → NOT_CONNECTED` — on explicit user exit

### 10.2. Stream State (client)

States:

- `IDLE`
- `PROVISIONING`
- `AWAITING_STREAM`
- `LIVE`
- `STOPPING`
- `FAILED`

Transitions:

- `IDLE → PROVISIONING` — clicking "Start Stream"
- `PROVISIONING → AWAITING_STREAM` — WHIP credentials received
- `AWAITING_STREAM → LIVE` — ingress participant (`stream:*`) detected in LiveKit room
- `LIVE → STOPPING` — clicking "Stop Stream"
- `STOPPING → IDLE` — after cleanup

Error transitions:

- `PROVISIONING → FAILED`
- `AWAITING_STREAM → FAILED`
- `LIVE → FAILED`

From `FAILED`, the only allowed transition is to `IDLE` (via "Try Again").

---

## 11. Frontend Module Organization

### 11.1. Frontend Modules

The frontend codebase (`web/`) contains the following modules:

- `services/api.ts` (REST client for Control API)
- `stores/` (Zustand state stores)
- `hooks/` (React hooks for LiveKit, chat, etc.)
- `components/` (React UI components)
- `types/index.ts` (TypeScript types)

### 11.2. Module Responsibilities

#### `services/api.ts`

- HTTP requests to Control API via relative URLs (`/api/v1/...`)
- `validateAdminToken`, `createRoom`, `joinRoom`, `leaveRoom`
- `startStream`, `stopStream`
- `getChatHistory`, `sendChatMessage`

#### `stores/`

- `roomStore` — room state (`state`, `roomId`, `participantId`, `inviteToken`, `reconnecting`)
- `streamStore` — stream state (`state`, `error`, `whipInfo`, `streamSessionId`)
- `chatStore` — chat messages
- `participantStore` — participant list with speaking indicators

#### `hooks/`

- `useLiveKitRoom` — LiveKit connection, participant event handling, ingress participant detection
- `useChat` — history loading, sending/receiving messages via LiveKit chat API
- `useVoiceChat` — microphone toggle

#### `components/`

- `VideoPanel` — renders the video stream track
- `StatusBar` — displays connection and stream status
- `VoiceControls` — microphone toggle button
- `ChatPanel` — text chat UI
- `BroadcastControls` — stream start/stop controls with WHIP credentials display
- `Participants` — participant list

---

## 12. UI/UX Rules

### 12.1. General Structure

The SPA opens in a web browser and consists of:

- Main video panel;
- Participants panel;
- Voice controls panel;
- Text chat;
- Stream management block;
- Status block.

### 12.2. UI Behavior — Viewer Mode

If the user is not the active broadcaster:

- They see the current video stream;
- They can control playback volume;
- They can enable/disable their microphone;
- They can send text messages;
- The stream management block is still visible (any user can start a stream if the slot is free).

### 12.3. UI Behavior — Streaming Mode

The stream management block has the following UI states:

- **IDLE**: "Start Stream" button
- **PROVISIONING**: spinner and "Setting up stream..."
- **AWAITING_STREAM**: WHIP URL and Bearer Token in read-only fields with "Copy" buttons; instruction to configure OBS; "Cancel" button
- **LIVE**: "LIVE" indicator and "Stop Stream" button
- **STOPPING**: spinner and "Stopping..."
- **FAILED**: error text and "Try Again" button

### 12.4. Admin Token UI Flow

On the main landing screen:

1. User enters their display name.
2. To create a room: user clicks "I have an admin token" → enters the admin token → clicks "Unlock" → the token is validated via API → "Create Room" button appears.
3. To join: user clicks "Join with Invite" → pastes the invite token → clicks "Join Room".

### 12.5. Invite Token Sharing

After creating a room, the invite token is displayed in the room's sidebar with a "Copy" button. Users share the raw token (not a URL). Recipients paste the token into the join flow.

### 12.6. UI Constraints

The product does not include:

- User camera;
- Local screen share via LiveKit SDK from browser UI;
- Multiple simultaneous video streams;
- Layout selection for multiple streamers;
- Recording;
- Streaming to external platforms.

---

## 13. Server Architecture

### 13.1. Components

The following services are deployed on the server:

- `control-api` (also serves the SPA frontend)
- `livekit` (requires Redis)
- `livekit-ingress`
- `redis` (LiveKit dependency)

SQLite is located locally alongside `control-api`.

### 13.2. `control-api` Requirements

`control-api` is implemented in Go and must perform:

- Room management (admin-gated creation);
- Invite token issuance;
- Join flow;
- LiveKit token issuance;
- Ingress provisioning;
- Ingress deletion;
- Chat persistence;
- Metadata storage.

### 13.3. LiveKit Integration

`control-api` must:

- Generate LiveKit access tokens for the client (`auth.NewAccessToken`, valid 1 hour);
- Create ingress via `lksdk.IngressClient.CreateIngress` with `IngressInput_WHIP_INPUT` and `BypassTranscoding: true`;
- Delete ingress when the stream ends;
- Reserve and free the stream slot in SQLite.

### 13.4. Configuration (Environment Variables)

| Variable | Default | Description |
|----------|---------|-------------|
| `SERVER_PORT` | `8080` | HTTP listen port |
| `DATABASE_PATH` | `./corvoicer.db` | SQLite database file path |
| `LIVEKIT_HOST` | `ws://127.0.0.1:7880` | LiveKit WebSocket URL |
| `LIVEKIT_API_KEY` | `devkey` | LiveKit API key |
| `LIVEKIT_API_SECRET` | `secret-dev-key-min-32-characters!!` | LiveKit API secret |
| `INVITE_TOKEN_SECRET` | *(required)* | HMAC secret for invite tokens (min 32 bytes) |
| `ADMIN_TOKEN` | *(required)* | Admin token for room creation (min 8 chars) |
| `ROOM_DEFAULT_TTL` | `24h` | Room TTL (Go duration format) |
| `LOG_LEVEL` | `info` | Log level: `debug`, `info`, `warn`, `error` |

---

## 14. Normative HTTP API (Control API)

All endpoints respond in JSON.
All timestamps are UTC in ISO 8601 format.

### 14.1. `GET /health`

Health check.

**Response:** `{"status": "ok"}`

### 14.2. `POST /api/v1/auth/validate-admin-token`

Validate an admin token before room creation.

**Request body:**

- `admin_token: string`

**Response:**

- `valid: boolean`

### 14.3. `POST /api/v1/rooms`

Create a room.

**Request body:**

- `owner_display_name: string` (1–50 characters)
- `admin_token: string`

**Response (`201 Created`):**

- `room_id: string`
- `invite_token: string`
- `invite_url: string` (currently `corvoicer://join?token=<token>`)
- `owner_session_id: string`
- `livekit_token: string`
- `livekit_url: string`

**Errors:**

- `403 INVALID_ADMIN_TOKEN` — invalid or missing admin token
- `400 INVALID_DISPLAY_NAME` — name not 1–50 characters

### 14.4. `POST /api/v1/rooms/join`

Join a room.

**Request body:**

- `invite_token: string`
- `display_name: string` (1–50 characters)

**Response (`200 OK`):**

- `room_id: string`
- `participant_session_id: string`
- `livekit_token: string`
- `livekit_url: string`
- `role: "owner" | "member"`

**Errors:**

- `401 INVALID_TOKEN` — invalid or expired invite token
- `410 ROOM_UNAVAILABLE` — room is closed or expired
- `409 ROOM_FULL` — room has reached 16 participants

### 14.5. `GET /api/v1/rooms/{room_id}`

Get room metadata.

**Response:**

- `room_id: string`
- `status: "open" | "closed"`
- `active_stream: boolean`
- `active_broadcaster_session_id: string | null`
- `participant_count: number`

### 14.6. `GET /api/v1/rooms/{room_id}/messages`

Get chat history.

**Query parameters:**

- `limit` (optional, max 100; server default applies if omitted)
- `before` (optional message ID cursor)

**Response:**

- `messages: ChatMessage[]`

### 14.7. `POST /api/v1/rooms/{room_id}/messages`

Persist a chat message.

**Request body:**

- `participant_session_id: string`
- `client_message_id: string`
- `text: string`

**Response:**

- `message_id: string`
- `persisted_at: string`

### 14.8. `POST /api/v1/rooms/{room_id}/stream/start`

Request to start streaming.

**Request body:**

- `participant_session_id: string`

**Response (`200 OK`):**

- `stream_session_id: string`
- `whip_url: string`
- `whip_bearer_token: string`
- `ingress_id: string`
- `ingress_participant_identity: string`

**Errors:**

- `409 STREAM_SLOT_OCCUPIED` — another stream is active
- `404 ROOM_NOT_FOUND`

### 14.9. `POST /api/v1/rooms/{room_id}/stream/stop`

Explicitly stop a stream.

**Request body:**

- `participant_session_id: string`
- `stream_session_id: string`

**Response:**

- `stopped: true`

**Errors:**

- `403 NOT_BROADCASTER` — only the broadcaster can stop the stream
- `404 STREAM_NOT_FOUND`

### 14.10. `POST /api/v1/rooms/{room_id}/leave`

Leave a room.

**Request body:**

- `participant_session_id: string`

**Response:**

- `left: true`

---

## 15. Data Models

### 15.1. Room

Fields:

- `room_id` TEXT PRIMARY KEY
- `invite_token_hash` TEXT NOT NULL UNIQUE (SHA-256 of the invite token)
- `status` TEXT NOT NULL DEFAULT `'open'` CHECK `('open', 'closed')`
- `owner_session_id` TEXT NOT NULL
- `active_stream_session_id` TEXT (nullable)
- `created_at` TEXT NOT NULL (UTC ISO 8601)
- `expires_at` TEXT NOT NULL (UTC ISO 8601)

### 15.2. ParticipantSession

Fields:

- `participant_session_id` TEXT PRIMARY KEY
- `room_id` TEXT NOT NULL REFERENCES rooms
- `display_name` TEXT NOT NULL
- `role` TEXT NOT NULL CHECK `('owner', 'member')`
- `joined_at` TEXT NOT NULL
- `left_at` TEXT (nullable)

### 15.3. StreamSession

Fields:

- `stream_session_id` TEXT PRIMARY KEY
- `room_id` TEXT NOT NULL REFERENCES rooms
- `participant_session_id` TEXT NOT NULL REFERENCES participant_sessions
- `state` TEXT NOT NULL (e.g. `'starting'`, `'ended'`)
- `ingress_id` TEXT (nullable)
- `ingress_participant_identity` TEXT (nullable)
- `started_at` TEXT NOT NULL
- `ended_at` TEXT (nullable)

### 15.4. ChatMessage

Fields:

- `message_id` TEXT PRIMARY KEY
- `room_id` TEXT NOT NULL REFERENCES rooms
- `participant_session_id` TEXT NOT NULL REFERENCES participant_sessions
- `client_message_id` TEXT NOT NULL
- `text` TEXT NOT NULL
- `created_at` TEXT NOT NULL

Unique constraint: `(room_id, client_message_id)`.

---

## 16. LiveKit Room Contract

### 16.1. General Rules

Each product room has a corresponding LiveKit room.

In this room:

- All participants are present;
- Participant audio tracks are published;
- Chat messages are transmitted (LiveKit built-in chat API);
- One video stream from the ingress participant is published.

### 16.2. Ingress Participant

The ingress always connects to the room as a separate participant with identity:

`stream:<room_id>`

The UI client must:

- Automatically subscribe to video tracks from this participant;
- Not implement active video selection by any other principle.

The client must:

- When a participant with identity `stream:*` connects and current stream state is `AWAITING_STREAM` → transition to `LIVE`;
- When a participant with identity `stream:*` disconnects → handle this as ingest loss (→ `FAILED` if stream was `LIVE`).

### 16.3. Client Publications

Clients publish only:

- Microphone audio track;
- Chat messages (via LiveKit built-in chat API).

Clients do not publish:

- Camera;
- Screen share;
- Video tracks of any other type.

---

## 17. Logging and Diagnostics

### 17.1. Client Logs

The client (SPA) writes logs to the browser console (`console.log`, `console.error`).

Rotational file logs are not used — the client runs in a web browser.

### 17.2. Server Logs

The server writes structured JSON logs to stdout using `log/slog`.

Services:

- `control-api` stdout/stderr
- `livekit` stdout/stderr
- `livekit-ingress` stdout/stderr

### 17.3. Log Levels

Supported levels:

- `DEBUG`
- `INFO`
- `WARN`
- `ERROR`

Production default: `INFO`.
Development default: `debug` (set in `run.sh`).

---

## 18. Network Configuration

### 18.1. Development (Localhost)

All services run on `127.0.0.1` without NAT traversal.

Critical `deploy/config/ingress.yaml` settings:

```yaml
rtc_config:  # Must be rtc_config, not rtc!
  enable_loopback_candidate: true  # Required for localhost ICE
  stun_servers: []                 # Disable STUN
  node_ip: 127.0.0.1
  use_external_ip: false
```

- WHIP URL must use `http://127.0.0.1:7985/w` (not `localhost`) to force IPv4.
- STUN is disabled in both `livekit.yaml` and `ingress.yaml`.
- LiveKit Server uses `rtc:` key; LiveKit Ingress uses `rtc_config:` key.

### 18.2. Production (Dedicated IPv4)

- Server must have a dedicated public IPv4 address.
- STUN enabled for NAT traversal (`stun:stun.l.google.com:19302`).
- `use_external_ip: true` to advertise the server's public IP.
- TURN is not required (STUN sufficient for home/mobile networks).
- Deployed as systemd services behind an nginx reverse proxy with TLS (Let's Encrypt).
- **IPv6 warning:** Broken IPv6 routing causes STUN timeout. Fix routing or disable IPv6 on the server.

---

## 19. Background Maintenance

A background cleanup job runs every **5 minutes**:

- Deletes expired rooms (past `expires_at`);
- Deletes chat messages older than the retention period (**30 days** by default, configured via `ChatRetentionDays`).

---

## 20. Explicitly Excluded Features

The following features are **not part of the product** and must not be implemented:

- User registration;
- Persistent accounts;
- Friends list;
- Mobile client;
- Web camera publishing;
- Multiple simultaneous streamers in one room;
- Stream recording;
- VOD;
- Screen share via `getDisplayMedia()` as a user-facing feature;
- Custom TURN/STUN server;
- Custom SFU;
- P2P mesh;
- Embedded OBS management (WebSocket, process, configuration);
- Remote desktop control;
- Mouse/keyboard input forwarding;
- Collaborative game control;
- DRM bypass;
- Importing local media files into a room without streaming.

---

## 21. Final Fixed Architecture Contract

The implemented solution must conform to the following formula:

- **Client:** web SPA (React + TypeScript + Tailwind CSS + Vite), embedded in Go server via `go:embed`
- **Streaming:** user uses their own external OBS with WHIP output
- **Realtime room/voice/view:** self-hosted LiveKit (requires Redis)
- **Ingress:** LiveKit Ingress
- **Ingest protocol:** WHIP only, with `BypassTranscoding: true`
- **NAT traversal:** LiveKit built-in STUN (disabled in dev, enabled in prod)
- **Control plane:** custom Go `control-api` (serves SPA + REST API)
- **Persistence:** SQLite
- **Room creation:** gated by `ADMIN_TOKEN`
- **Room capacity:** up to 16 participants
- **Streams:** one active per room
- **All platforms:** broadcaster path via external OBS

---

## 22. Implementation Compliance Criteria

An implementation is considered compliant only when all of the following conditions are simultaneously satisfied:

1. A user with an admin token can create a room; other users can join without an admin token.
2. All participants can connect via web browser on any OS.
3. Voice chat is available in the room.
4. Text chat is available with real-time delivery and history persistence.
5. There can be exactly one active stream in a room.
6. The stream goes through the user's external OBS → WHIP → LiveKit Ingress.
7. The screen share path via browser APIs is not used.
8. The application displays the WHIP URL and Bearer Token for manual OBS configuration.
9. NAT traversal is handled via LiveKit's built-in STUN (in production).
10. All solutions above are implemented without substituting components for alternatives.
