package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/vkochetkov/corvoicer/server/internal/domain"
)

type MessageRepo struct {
	db *sql.DB
}

func NewMessageRepo(db *sql.DB) *MessageRepo {
	return &MessageRepo{db: db}
}

func (r *MessageRepo) Create(ctx context.Context, m *domain.ChatMessage) error {
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO chat_messages (message_id, room_id, participant_session_id, client_message_id, text, created_at)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		m.MessageID,
		m.RoomID,
		m.ParticipantSessionID,
		m.ClientMessageID,
		m.Text,
		m.CreatedAt.UTC().Format(time.RFC3339),
	)
	if err != nil {
		if isUniqueViolation(err) {
			return domain.ErrMessageDuplicate
		}
		return fmt.Errorf("insert message: %w", err)
	}
	return nil
}

func (r *MessageRepo) ListByRoom(ctx context.Context, roomID string, limit int, beforeID string) ([]domain.ChatMessage, error) {
	var rows *sql.Rows
	var err error

	if beforeID != "" {
		rows, err = r.db.QueryContext(ctx,
			`SELECT m.message_id, m.room_id, m.participant_session_id, m.client_message_id, m.text, m.created_at,
			        COALESCE(p.display_name, '') AS display_name
			 FROM chat_messages m
			 LEFT JOIN participant_sessions p ON m.participant_session_id = p.participant_session_id
			 WHERE m.room_id = ? AND m.created_at < (SELECT created_at FROM chat_messages WHERE message_id = ?)
			 ORDER BY m.created_at DESC
			 LIMIT ?`, roomID, beforeID, limit)
	} else {
		rows, err = r.db.QueryContext(ctx,
			`SELECT m.message_id, m.room_id, m.participant_session_id, m.client_message_id, m.text, m.created_at,
			        COALESCE(p.display_name, '') AS display_name
			 FROM chat_messages m
			 LEFT JOIN participant_sessions p ON m.participant_session_id = p.participant_session_id
			 WHERE m.room_id = ?
			 ORDER BY m.created_at DESC
			 LIMIT ?`, roomID, limit)
	}
	if err != nil {
		return nil, fmt.Errorf("list messages: %w", err)
	}
	defer rows.Close()

	var result []domain.ChatMessage
	for rows.Next() {
		var m domain.ChatMessage
		var createdAt string
		if err := rows.Scan(&m.MessageID, &m.RoomID, &m.ParticipantSessionID, &m.ClientMessageID, &m.Text, &createdAt, &m.DisplayName); err != nil {
			return nil, fmt.Errorf("scan message row: %w", err)
		}
		m.CreatedAt, err = time.Parse(time.RFC3339, createdAt)
		if err != nil {
			return nil, fmt.Errorf("parse created_at: %w", err)
		}
		result = append(result, m)
	}
	return result, rows.Err()
}

func (r *MessageRepo) CountByRoom(ctx context.Context, roomID string) (int, error) {
	var count int
	err := r.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM chat_messages WHERE room_id = ?`, roomID).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("count messages: %w", err)
	}
	return count, nil
}

func (r *MessageRepo) DeleteOlderThan(ctx context.Context, roomID string, maxCount int) (int64, error) {
	res, err := r.db.ExecContext(ctx,
		`DELETE FROM chat_messages WHERE room_id = ? AND message_id NOT IN (
			SELECT message_id FROM chat_messages WHERE room_id = ?
			ORDER BY created_at DESC LIMIT ?
		)`, roomID, roomID, maxCount)
	if err != nil {
		return 0, fmt.Errorf("delete excess messages: %w", err)
	}
	return res.RowsAffected()
}

func (r *MessageRepo) DeleteExpired(ctx context.Context, retentionDays int) (int64, error) {
	cutoff := time.Now().UTC().AddDate(0, 0, -retentionDays).Format(time.RFC3339)
	res, err := r.db.ExecContext(ctx,
		`DELETE FROM chat_messages WHERE created_at < ?`, cutoff)
	if err != nil {
		return 0, fmt.Errorf("delete expired messages: %w", err)
	}
	return res.RowsAffected()
}

func isUniqueViolation(err error) bool {
	if err == nil {
		return false
	}
	// The modernc.org/sqlite driver returns errors with an error code.
	// SQLITE_CONSTRAINT_UNIQUE = 2067, SQLITE_CONSTRAINT = 19.
	type sqliteErr interface {
		Code() int
	}
	var sqErr sqliteErr
	if errors.As(err, &sqErr) {
		code := sqErr.Code()
		return code == 2067 || code == 19
	}
	// Fallback for drivers that don't expose structured error codes
	if strings.Contains(err.Error(), "UNIQUE constraint failed") {
		return true
	}
	return false
}
