package service

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/vkochetkov/corvoicer/server/internal/domain"
	lk "github.com/vkochetkov/corvoicer/server/internal/livekit"
	"github.com/vkochetkov/corvoicer/server/internal/repository"
)

type StreamService struct {
	rooms       repository.RoomRepository
	streams     repository.StreamRepository
	ingress     *lk.IngressService
	whipBaseURL string
}

func NewStreamService(
	rooms repository.RoomRepository,
	streams repository.StreamRepository,
	ingress *lk.IngressService,
	whipBaseURL string,
) *StreamService {
	return &StreamService{rooms: rooms, streams: streams, ingress: ingress, whipBaseURL: whipBaseURL}
}

type StartStreamResult struct {
	StreamSessionID            string `json:"stream_session_id"`
	WhipURL                    string `json:"whip_url"`
	WhipBearerToken            string `json:"whip_bearer_token"`
	IngressID                  string `json:"ingress_id"`
	IngressParticipantIdentity string `json:"ingress_participant_identity"`
}

func (s *StreamService) StartStream(ctx context.Context, roomID, participantSessionID string) (*StartStreamResult, error) {
	room, err := s.rooms.GetByID(ctx, roomID)
	if err != nil {
		return nil, err
	}

	// Only the room owner can start a stream
	if room.OwnerSessionID != participantSessionID {
		return nil, domain.ErrNotOwner
	}

	if room.ActiveStreamSessionID != nil {
		return nil, domain.ErrStreamSlotOccupied
	}

	ingressResult, err := s.ingress.CreateWHIPIngress(ctx, roomID)
	if err != nil {
		return nil, fmt.Errorf("create ingress: %w", err)
	}

	streamID := uuid.New().String()
	now := time.Now().UTC()

	stream := &domain.StreamSession{
		StreamSessionID:            streamID,
		RoomID:                     roomID,
		ParticipantSessionID:       participantSessionID,
		State:                      "starting",
		IngressID:                  &ingressResult.IngressID,
		IngressParticipantIdentity: &ingressResult.ParticipantIdentity,
		StartedAt:                  now,
	}

	if err := s.streams.Create(ctx, stream); err != nil {
		s.ingress.DeleteIngress(ctx, ingressResult.IngressID)
		return nil, fmt.Errorf("create stream session: %w", err)
	}

	if err := s.rooms.SetActiveStream(ctx, roomID, &streamID); err != nil {
		s.ingress.DeleteIngress(ctx, ingressResult.IngressID)
		return nil, fmt.Errorf("set active stream: %w", err)
	}

	// Use configured WHIP base URL if set, otherwise use the one from LiveKit
	whipURL := ingressResult.URL
	if s.whipBaseURL != "" {
		whipURL = s.whipBaseURL
	}

	return &StartStreamResult{
		StreamSessionID:            streamID,
		WhipURL:                    whipURL,
		WhipBearerToken:            ingressResult.StreamKey,
		IngressID:                  ingressResult.IngressID,
		IngressParticipantIdentity: ingressResult.ParticipantIdentity,
	}, nil
}

func (s *StreamService) StopStream(ctx context.Context, roomID, participantSessionID, streamSessionID string) error {
	stream, err := s.streams.GetByID(ctx, streamSessionID)
	if err != nil {
		return err
	}

	if stream.ParticipantSessionID != participantSessionID {
		return domain.ErrNotBroadcaster
	}

	if stream.IngressID != nil {
		s.ingress.DeleteIngress(ctx, *stream.IngressID)
	}

	if err := s.streams.End(ctx, streamSessionID); err != nil {
		return fmt.Errorf("end stream: %w", err)
	}

	if err := s.rooms.SetActiveStream(ctx, roomID, nil); err != nil {
		return fmt.Errorf("clear active stream: %w", err)
	}

	return nil
}
