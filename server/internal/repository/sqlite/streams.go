package sqlite

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/vkochetkov/corvoicer/server/internal/domain"
)

type StreamRepo struct {
	db *sql.DB
}

func NewStreamRepo(db *sql.DB) *StreamRepo {
	return &StreamRepo{db: db}
}

func (r *StreamRepo) Create(ctx context.Context, s *domain.StreamSession) error {
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO stream_sessions
		 (stream_session_id, room_id, participant_session_id,
		  state, ingress_id, ingress_participant_identity, started_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		s.StreamSessionID,
		s.RoomID,
		s.ParticipantSessionID,
		s.State,
		s.IngressID,
		s.IngressParticipantIdentity,
		s.StartedAt.UTC().Format(time.RFC3339),
	)
	if err != nil {
		return fmt.Errorf("insert stream session: %w", err)
	}
	return nil
}

func (r *StreamRepo) GetByID(ctx context.Context, id string) (*domain.StreamSession, error) {
	return r.scanStream(r.db.QueryRowContext(ctx,
		`SELECT stream_session_id, room_id, participant_session_id,
		        state, ingress_id, ingress_participant_identity, started_at, ended_at
		 FROM stream_sessions WHERE stream_session_id = ?`, id))
}

func (r *StreamRepo) GetActiveByRoom(ctx context.Context, roomID string) (*domain.StreamSession, error) {
	return r.scanStream(r.db.QueryRowContext(ctx,
		`SELECT stream_session_id, room_id, participant_session_id,
		        state, ingress_id, ingress_participant_identity, started_at, ended_at
		 FROM stream_sessions WHERE room_id = ? AND ended_at IS NULL
		 ORDER BY started_at DESC LIMIT 1`, roomID))
}

func (r *StreamRepo) SetState(ctx context.Context, id string, state string) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE stream_sessions SET state = ? WHERE stream_session_id = ?`,
		state, id)
	if err != nil {
		return fmt.Errorf("set stream state: %w", err)
	}
	return nil
}

func (r *StreamRepo) End(ctx context.Context, id string) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE stream_sessions SET ended_at = ?, state = 'stopped' WHERE stream_session_id = ?`,
		time.Now().UTC().Format(time.RFC3339), id)
	if err != nil {
		return fmt.Errorf("end stream session: %w", err)
	}
	return nil
}

func (r *StreamRepo) scanStream(row *sql.Row) (*domain.StreamSession, error) {
	var s domain.StreamSession
	var startedAt string
	var endedAt, ingressID, ingressIdentity sql.NullString

	err := row.Scan(
		&s.StreamSessionID,
		&s.RoomID,
		&s.ParticipantSessionID,
		&s.State,
		&ingressID,
		&ingressIdentity,
		&startedAt,
		&endedAt,
	)
	if err == sql.ErrNoRows {
		return nil, domain.ErrStreamNotActive
	}
	if err != nil {
		return nil, fmt.Errorf("scan stream: %w", err)
	}

	s.StartedAt, _ = time.Parse(time.RFC3339, startedAt)
	if endedAt.Valid {
		t, _ := time.Parse(time.RFC3339, endedAt.String)
		s.EndedAt = &t
	}
	if ingressID.Valid {
		s.IngressID = &ingressID.String
	}
	if ingressIdentity.Valid {
		s.IngressParticipantIdentity = &ingressIdentity.String
	}

	return &s, nil
}
