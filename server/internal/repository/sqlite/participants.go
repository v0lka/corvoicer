package sqlite

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/vkochetkov/corvoicer/server/internal/domain"
)

type ParticipantRepo struct {
	db *sql.DB
}

func NewParticipantRepo(db *sql.DB) *ParticipantRepo {
	return &ParticipantRepo{db: db}
}

func (r *ParticipantRepo) Create(ctx context.Context, p *domain.ParticipantSession) error {
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO participant_sessions (participant_session_id, room_id, display_name, role, joined_at)
		 VALUES (?, ?, ?, ?, ?)`,
		p.ParticipantSessionID,
		p.RoomID,
		p.DisplayName,
		p.Role,
		p.JoinedAt.UTC().Format(time.RFC3339),
	)
	if err != nil {
		return fmt.Errorf("insert participant: %w", err)
	}
	return nil
}

func (r *ParticipantRepo) GetByID(ctx context.Context, id string) (*domain.ParticipantSession, error) {
	var p domain.ParticipantSession
	var joinedAt string
	var leftAt sql.NullString

	err := r.db.QueryRowContext(ctx,
		`SELECT participant_session_id, room_id, display_name, role, joined_at, left_at
		 FROM participant_sessions WHERE participant_session_id = ?`, id).Scan(
		&p.ParticipantSessionID,
		&p.RoomID,
		&p.DisplayName,
		&p.Role,
		&joinedAt,
		&leftAt,
	)
	if err == sql.ErrNoRows {
		return nil, domain.ErrParticipantNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("scan participant: %w", err)
	}

	p.JoinedAt, _ = time.Parse(time.RFC3339, joinedAt)
	if leftAt.Valid {
		t, _ := time.Parse(time.RFC3339, leftAt.String)
		p.LeftAt = &t
	}

	return &p, nil
}

func (r *ParticipantRepo) SetLeftAt(ctx context.Context, id string) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE participant_sessions SET left_at = ? WHERE participant_session_id = ?`,
		time.Now().UTC().Format(time.RFC3339), id)
	if err != nil {
		return fmt.Errorf("set left_at: %w", err)
	}
	return nil
}

func (r *ParticipantRepo) ClearLeftAt(ctx context.Context, id string) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE participant_sessions SET left_at = NULL WHERE participant_session_id = ?`,
		id)
	if err != nil {
		return fmt.Errorf("clear left_at: %w", err)
	}
	return nil
}

func (r *ParticipantRepo) ListActiveByRoom(ctx context.Context, roomID string) ([]domain.ParticipantSession, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT participant_session_id, room_id, display_name, role, joined_at, left_at
		 FROM participant_sessions WHERE room_id = ? AND left_at IS NULL
		 ORDER BY joined_at ASC`, roomID)
	if err != nil {
		return nil, fmt.Errorf("list active participants: %w", err)
	}
	defer rows.Close()

	var result []domain.ParticipantSession
	for rows.Next() {
		var p domain.ParticipantSession
		var joinedAt string
		var leftAt sql.NullString
		if err := rows.Scan(&p.ParticipantSessionID, &p.RoomID, &p.DisplayName, &p.Role, &joinedAt, &leftAt); err != nil {
			return nil, fmt.Errorf("scan participant row: %w", err)
		}
		p.JoinedAt, _ = time.Parse(time.RFC3339, joinedAt)
		result = append(result, p)
	}
	return result, rows.Err()
}
