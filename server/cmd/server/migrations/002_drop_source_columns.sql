-- Remove source_kind, source_ref, include_system_audio from stream_sessions.
-- OBS is no longer managed by the app; these fields are unnecessary.

CREATE TABLE stream_sessions_new (
  stream_session_id            TEXT PRIMARY KEY,
  room_id                      TEXT NOT NULL REFERENCES rooms(room_id) ON DELETE CASCADE,
  participant_session_id       TEXT NOT NULL REFERENCES participant_sessions(participant_session_id),
  state                        TEXT NOT NULL,
  ingress_id                   TEXT,
  ingress_participant_identity TEXT,
  started_at                   TEXT NOT NULL,
  ended_at                     TEXT
);

INSERT INTO stream_sessions_new
  (stream_session_id, room_id, participant_session_id, state,
   ingress_id, ingress_participant_identity, started_at, ended_at)
SELECT
  stream_session_id, room_id, participant_session_id, state,
  ingress_id, ingress_participant_identity, started_at, ended_at
FROM stream_sessions;

DROP TABLE stream_sessions;
ALTER TABLE stream_sessions_new RENAME TO stream_sessions;

CREATE INDEX idx_streams_room ON stream_sessions(room_id);
