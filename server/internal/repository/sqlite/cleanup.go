package sqlite

import (
	"context"
	"log/slog"
	"time"
)

type CleanupRunner struct {
	rooms    *RoomRepo
	messages *MessageRepo
}

func NewCleanupRunner(rooms *RoomRepo, messages *MessageRepo) *CleanupRunner {
	return &CleanupRunner{rooms: rooms, messages: messages}
}

func (c *CleanupRunner) RunOnce(ctx context.Context, retentionDays int) {
	expired, err := c.rooms.DeleteExpired(ctx)
	if err != nil {
		slog.Error("cleanup: delete expired rooms", "error", err)
	} else if expired > 0 {
		slog.Info("cleanup: deleted expired rooms", "count", expired)
	}

	deleted, err := c.messages.DeleteExpired(ctx, retentionDays)
	if err != nil {
		slog.Error("cleanup: delete expired messages", "error", err)
	} else if deleted > 0 {
		slog.Info("cleanup: deleted expired messages", "count", deleted)
	}
}

func (c *CleanupRunner) Start(ctx context.Context, interval time.Duration, retentionDays int) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			slog.Info("cleanup: stopped")
			return
		case <-ticker.C:
			c.RunOnce(ctx, retentionDays)
		}
	}
}
