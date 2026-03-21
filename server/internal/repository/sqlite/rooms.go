package sqlite

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/vkochetkov/corvoicer/server/internal/domain"
)

type RoomRepo struct {
	db *sql.DB
}

func NewRoomRepo(db *sql.DB) *RoomRepo {
	return &RoomRepo{db: db}
}

func (r *RoomRepo) Create(ctx context.Context, room *domain.Room) error {
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO rooms (room_id, invite_token_hash, status, owner_session_id, active_stream_session_id, created_at, expires_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		room.RoomID,
		room.InviteTokenHash,
		room.Status,
		room.OwnerSessionID,
		room.ActiveStreamSessionID,
		room.CreatedAt.UTC().Format(time.RFC3339),
		room.ExpiresAt.UTC().Format(time.RFC3339),
	)
	if err != nil {
		return fmt.Errorf("insert room: %w", err)
	}
	return nil
}

func (r *RoomRepo) GetByID(ctx context.Context, roomID string) (*domain.Room, error) {
	return r.scanRoom(r.db.QueryRowContext(ctx,
		`SELECT room_id, invite_token_hash, status, owner_session_id, active_stream_session_id, created_at, expires_at
		 FROM rooms WHERE room_id = ?`, roomID))
}

func (r *RoomRepo) GetByInviteTokenHash(ctx context.Context, hash string) (*domain.Room, error) {
	return r.scanRoom(r.db.QueryRowContext(ctx,
		`SELECT room_id, invite_token_hash, status, owner_session_id, active_stream_session_id, created_at, expires_at
		 FROM rooms WHERE invite_token_hash = ?`, hash))
}

func (r *RoomRepo) SetActiveStream(ctx context.Context, roomID string, streamSessionID *string) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE rooms SET active_stream_session_id = ? WHERE room_id = ?`,
		streamSessionID, roomID)
	if err != nil {
		return fmt.Errorf("set active stream: %w", err)
	}
	return nil
}

func (r *RoomRepo) SetStatus(ctx context.Context, roomID string, status string) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE rooms SET status = ? WHERE room_id = ?`,
		status, roomID)
	if err != nil {
		return fmt.Errorf("set room status: %w", err)
	}
	return nil
}

func (r *RoomRepo) CountActiveParticipants(ctx context.Context, roomID string) (int, error) {
	var count int
	err := r.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM participant_sessions WHERE room_id = ? AND left_at IS NULL`,
		roomID).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("count active participants: %w", err)
	}
	return count, nil
}

func (r *RoomRepo) DeleteExpired(ctx context.Context) (int64, error) {
	res, err := r.db.ExecContext(ctx,
		`DELETE FROM rooms WHERE expires_at < ? AND status = 'open'`,
		time.Now().UTC().Format(time.RFC3339))
	if err != nil {
		return 0, fmt.Errorf("delete expired rooms: %w", err)
	}
	return res.RowsAffected()
}

func (r *RoomRepo) scanRoom(row *sql.Row) (*domain.Room, error) {
	var room domain.Room
	var createdAt, expiresAt string
	var activeStream sql.NullString

	err := row.Scan(
		&room.RoomID,
		&room.InviteTokenHash,
		&room.Status,
		&room.OwnerSessionID,
		&activeStream,
		&createdAt,
		&expiresAt,
	)
	if err == sql.ErrNoRows {
		return nil, domain.ErrRoomNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("scan room: %w", err)
	}

	room.CreatedAt, _ = time.Parse(time.RFC3339, createdAt)
	room.ExpiresAt, _ = time.Parse(time.RFC3339, expiresAt)
	if activeStream.Valid {
		room.ActiveStreamSessionID = &activeStream.String
	}

	return &room, nil
}
