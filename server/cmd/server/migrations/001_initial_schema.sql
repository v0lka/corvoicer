CREATE TABLE rooms (
  room_id            TEXT PRIMARY KEY,
  invite_token_hash  TEXT NOT NULL UNIQUE,
  status             TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),
  owner_session_id   TEXT NOT NULL,
  active_stream_session_id TEXT,
  created_at         TEXT NOT NULL,
  expires_at         TEXT NOT NULL
);

CREATE TABLE participant_sessions (
  participant_session_id TEXT PRIMARY KEY,
  room_id                TEXT NOT NULL REFERENCES rooms(room_id) ON DELETE CASCADE,
  display_name           TEXT NOT NULL,
  role                   TEXT NOT NULL CHECK(role IN ('owner','member')),
  joined_at              TEXT NOT NULL,
  left_at                TEXT
);

CREATE TABLE stream_sessions (
  stream_session_id           TEXT PRIMARY KEY,
  room_id                     TEXT NOT NULL REFERENCES rooms(room_id) ON DELETE CASCADE,
  participant_session_id      TEXT NOT NULL REFERENCES participant_sessions(participant_session_id),
  source_kind                 TEXT NOT NULL CHECK(source_kind IN ('game','window','display')),
  source_ref                  TEXT NOT NULL,
  include_system_audio        INTEGER NOT NULL DEFAULT 0,
  state                       TEXT NOT NULL,
  ingress_id                  TEXT,
  ingress_participant_identity TEXT,
  started_at                  TEXT NOT NULL,
  ended_at                    TEXT
);

CREATE TABLE chat_messages (
  message_id              TEXT PRIMARY KEY,
  room_id                 TEXT NOT NULL REFERENCES rooms(room_id) ON DELETE CASCADE,
  participant_session_id  TEXT NOT NULL REFERENCES participant_sessions(participant_session_id),
  client_message_id       TEXT NOT NULL,
  text                    TEXT NOT NULL,
  created_at              TEXT NOT NULL,
  UNIQUE(room_id, client_message_id)
);

CREATE INDEX idx_rooms_expires ON rooms(expires_at);
CREATE INDEX idx_rooms_status ON rooms(status);
CREATE INDEX idx_participants_room ON participant_sessions(room_id);
CREATE INDEX idx_streams_room ON stream_sessions(room_id);
CREATE INDEX idx_messages_room_time ON chat_messages(room_id, created_at DESC);
CREATE INDEX idx_messages_retention ON chat_messages(created_at);
