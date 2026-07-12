package service

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/vkochetkov/corvoicer/server/internal/domain"
	"github.com/vkochetkov/corvoicer/server/internal/repository"
)

type MessageService struct {
	messages     repository.MessageRepository
	maxPerRoom   int
}

func NewMessageService(messages repository.MessageRepository, maxPerRoom int) *MessageService {
	return &MessageService{messages: messages, maxPerRoom: maxPerRoom}
}

type SendMessageResult struct {
	MessageID   string `json:"message_id"`
	PersistedAt string `json:"persisted_at"`
}

func (s *MessageService) SendMessage(ctx context.Context, roomID, participantSessionID, clientMessageID, text string) (*SendMessageResult, error) {
	if text == "" || len(text) > 2000 {
		return nil, fmt.Errorf("message text must be 1-2000 characters")
	}

	now := time.Now().UTC()
	msg := &domain.ChatMessage{
		MessageID:            uuid.New().String(),
		RoomID:               roomID,
		ParticipantSessionID: participantSessionID,
		ClientMessageID:      clientMessageID,
		Text:                 text,
		CreatedAt:            now,
	}

	if err := s.messages.Create(ctx, msg); err != nil {
		return nil, err
	}

	// Enforce max messages per room (only when limit is exceeded)
	count, err := s.messages.CountByRoom(ctx, roomID)
	if err == nil && count > s.maxPerRoom {
		if _, err := s.messages.DeleteOlderThan(ctx, roomID, s.maxPerRoom); err != nil {
			slog.Error("failed to enforce message limit", "room_id", roomID, "error", err)
		}
	}

	return &SendMessageResult{
		MessageID:   msg.MessageID,
		PersistedAt: now.Format(time.RFC3339),
	}, nil
}

func (s *MessageService) GetHistory(ctx context.Context, roomID string, limit int, beforeID string) ([]domain.ChatMessage, error) {
	if limit <= 0 || limit > 100 {
		limit = 100
	}
	return s.messages.ListByRoom(ctx, roomID, limit, beforeID)
}
