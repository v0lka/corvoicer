package repository

import (
	"context"

	"github.com/vkochetkov/corvoicer/server/internal/domain"
)

type RoomRepository interface {
	Create(ctx context.Context, room *domain.Room) error
	GetByID(ctx context.Context, roomID string) (*domain.Room, error)
	GetByInviteTokenHash(ctx context.Context, hash string) (*domain.Room, error)
	SetActiveStream(ctx context.Context, roomID string, streamSessionID *string) error
	SetStatus(ctx context.Context, roomID string, status string) error
	CountActiveParticipants(ctx context.Context, roomID string) (int, error)
	DeleteExpired(ctx context.Context) (int64, error)
}

type ParticipantRepository interface {
	Create(ctx context.Context, p *domain.ParticipantSession) error
	GetByID(ctx context.Context, id string) (*domain.ParticipantSession, error)
	SetLeftAt(ctx context.Context, id string) error
	ClearLeftAt(ctx context.Context, id string) error
	SetMutedByOwner(ctx context.Context, participantSessionID string, muted bool) error
	ListActiveByRoom(ctx context.Context, roomID string) ([]domain.ParticipantSession, error)
}

type StreamRepository interface {
	Create(ctx context.Context, s *domain.StreamSession) error
	GetByID(ctx context.Context, id string) (*domain.StreamSession, error)
	GetActiveByRoom(ctx context.Context, roomID string) (*domain.StreamSession, error)
	SetState(ctx context.Context, id string, state string) error
	End(ctx context.Context, id string) error
}

type MessageRepository interface {
	Create(ctx context.Context, m *domain.ChatMessage) error
	ListByRoom(ctx context.Context, roomID string, limit int, beforeID string) ([]domain.ChatMessage, error)
	CountByRoom(ctx context.Context, roomID string) (int, error)
	DeleteOlderThan(ctx context.Context, roomID string, maxCount int) (int64, error)
	DeleteExpired(ctx context.Context, retentionDays int) (int64, error)
}
