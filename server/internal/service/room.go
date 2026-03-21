package service

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/vkochetkov/corvoicer/server/internal/domain"
	"github.com/vkochetkov/corvoicer/server/internal/repository"
)

type RoomService struct {
	rooms           repository.RoomRepository
	participants    repository.ParticipantRepository
	streams         repository.StreamRepository
	invites         *InviteService
	defaultTTL      time.Duration
	maxParticipants int
}

func NewRoomService(
	rooms repository.RoomRepository,
	participants repository.ParticipantRepository,
	streams repository.StreamRepository,
	invites *InviteService,
	defaultTTL time.Duration,
	maxParticipants int,
) *RoomService {
	return &RoomService{
		rooms:           rooms,
		participants:    participants,
		streams:         streams,
		invites:         invites,
		defaultTTL:      defaultTTL,
		maxParticipants: maxParticipants,
	}
}

type CreateRoomResult struct {
	RoomID         string `json:"room_id"`
	InviteToken    string `json:"invite_token"`
	InviteURL      string `json:"invite_url"`
	OwnerSessionID string `json:"owner_session_id"`
}

func (s *RoomService) CreateRoom(ctx context.Context, ownerDisplayName string) (*CreateRoomResult, error) {
	roomID := uuid.New().String()
	ownerSessionID := uuid.New().String()
	now := time.Now().UTC()
	expiresAt := now.Add(s.defaultTTL)

	inviteToken := s.invites.GenerateToken(roomID, expiresAt)
	tokenHash := s.invites.HashToken(inviteToken)

	room := &domain.Room{
		RoomID:          roomID,
		InviteTokenHash: tokenHash,
		Status:          "open",
		OwnerSessionID:  ownerSessionID,
		CreatedAt:       now,
		ExpiresAt:       expiresAt,
	}

	if err := s.rooms.Create(ctx, room); err != nil {
		return nil, fmt.Errorf("create room: %w", err)
	}

	owner := &domain.ParticipantSession{
		ParticipantSessionID: ownerSessionID,
		RoomID:               roomID,
		DisplayName:          ownerDisplayName,
		Role:                 "owner",
		JoinedAt:             now,
	}

	if err := s.participants.Create(ctx, owner); err != nil {
		return nil, fmt.Errorf("create owner session: %w", err)
	}

	return &CreateRoomResult{
		RoomID:         roomID,
		InviteToken:    inviteToken,
		InviteURL:      "corvoicer://join?token=" + inviteToken,
		OwnerSessionID: ownerSessionID,
	}, nil
}

type JoinRoomResult struct {
	RoomID               string      `json:"room_id"`
	ParticipantSessionID string      `json:"participant_session_id"`
	Role                 string      `json:"role"`
	ActiveStream         *StreamInfo `json:"active_stream,omitempty"`
}

func (s *RoomService) JoinRoom(ctx context.Context, inviteToken string, displayName string) (*JoinRoomResult, error) {
	roomID, err := s.invites.ValidateToken(inviteToken)
	if err != nil {
		return nil, err
	}

	room, err := s.rooms.GetByID(ctx, roomID)
	if err != nil {
		return nil, err
	}

	if room.Status != "open" {
		return nil, domain.ErrRoomClosed
	}

	if time.Now().UTC().After(room.ExpiresAt) {
		return nil, domain.ErrRoomExpired
	}

	count, err := s.rooms.CountActiveParticipants(ctx, roomID)
	if err != nil {
		return nil, fmt.Errorf("count participants: %w", err)
	}
	if count >= s.maxParticipants {
		return nil, domain.ErrRoomFull
	}

	sessionID := uuid.New().String()
	participant := &domain.ParticipantSession{
		ParticipantSessionID: sessionID,
		RoomID:               roomID,
		DisplayName:          displayName,
		Role:                 "member",
		JoinedAt:             time.Now().UTC(),
	}

	if err := s.participants.Create(ctx, participant); err != nil {
		return nil, fmt.Errorf("create participant: %w", err)
	}

	result := &JoinRoomResult{
		RoomID:               roomID,
		ParticipantSessionID: sessionID,
		Role:                 "member",
	}

	// Check if there's an active stream in the room
	if room.ActiveStreamSessionID != nil {
		stream, err := s.streams.GetByID(ctx, *room.ActiveStreamSessionID)
		if err == nil {
			result.ActiveStream = &StreamInfo{
				StreamSessionID: stream.StreamSessionID,
				State:           stream.State,
			}
		}
	}

	return result, nil
}

type RoomInfo struct {
	RoomID                     string  `json:"room_id"`
	Status                     string  `json:"status"`
	ActiveStream               bool    `json:"active_stream"`
	ActiveBroadcasterSessionID *string `json:"active_broadcaster_session_id"`
	ParticipantCount           int     `json:"participant_count"`
}

func (s *RoomService) GetRoomInfo(ctx context.Context, roomID string) (*RoomInfo, error) {
	room, err := s.rooms.GetByID(ctx, roomID)
	if err != nil {
		return nil, err
	}

	count, err := s.rooms.CountActiveParticipants(ctx, roomID)
	if err != nil {
		return nil, fmt.Errorf("count participants: %w", err)
	}

	var broadcasterID *string
	if room.ActiveStreamSessionID != nil {
		stream, err := s.streams.GetByID(ctx, *room.ActiveStreamSessionID)
		if err == nil {
			broadcasterID = &stream.ParticipantSessionID
		}
	}

	return &RoomInfo{
		RoomID:                     room.RoomID,
		Status:                     room.Status,
		ActiveStream:               room.ActiveStreamSessionID != nil,
		ActiveBroadcasterSessionID: broadcasterID,
		ParticipantCount:           count,
	}, nil
}

func (s *RoomService) LeaveRoom(ctx context.Context, participantSessionID string) error {
	participant, err := s.participants.GetByID(ctx, participantSessionID)
	if err != nil {
		return err
	}

	if err := s.participants.SetLeftAt(ctx, participantSessionID); err != nil {
		return fmt.Errorf("set left_at: %w", err)
	}

	room, err := s.rooms.GetByID(ctx, participant.RoomID)
	if err != nil {
		return err
	}

	// If the leaving participant is the active broadcaster, end the stream
	if room.ActiveStreamSessionID != nil {
		stream, err := s.streams.GetByID(ctx, *room.ActiveStreamSessionID)
		if err == nil && stream.ParticipantSessionID == participantSessionID {
			s.streams.End(ctx, stream.StreamSessionID)
			s.rooms.SetActiveStream(ctx, room.RoomID, nil)
		}
	}

	return nil
}

type RejoinRoomResult struct {
	RoomID               string      `json:"room_id"`
	ParticipantSessionID string      `json:"participant_session_id"`
	Role                 string      `json:"role"`
	DisplayName          string      `json:"display_name"`
	ActiveStream         *StreamInfo `json:"active_stream,omitempty"`
}

type StreamInfo struct {
	StreamSessionID string `json:"stream_session_id"`
	State           string `json:"state"`
}

func (s *RoomService) RejoinRoom(ctx context.Context, participantSessionID string) (*RejoinRoomResult, error) {
	participant, err := s.participants.GetByID(ctx, participantSessionID)
	if err != nil {
		return nil, err
	}

	room, err := s.rooms.GetByID(ctx, participant.RoomID)
	if err != nil {
		return nil, err
	}

	if room.Status != "open" {
		return nil, domain.ErrRoomClosed
	}

	if time.Now().UTC().After(room.ExpiresAt) {
		return nil, domain.ErrRoomExpired
	}

	// Clear left_at to mark participant as active again
	if err := s.participants.ClearLeftAt(ctx, participantSessionID); err != nil {
		return nil, fmt.Errorf("clear left_at: %w", err)
	}

	result := &RejoinRoomResult{
		RoomID:               participant.RoomID,
		ParticipantSessionID: participant.ParticipantSessionID,
		Role:                 participant.Role,
		DisplayName:          participant.DisplayName,
	}

	// Check if there's an active stream and if this participant is the broadcaster
	if room.ActiveStreamSessionID != nil {
		stream, err := s.streams.GetByID(ctx, *room.ActiveStreamSessionID)
		if err == nil && stream.ParticipantSessionID == participantSessionID {
			// This participant is the broadcaster of the active stream
			result.ActiveStream = &StreamInfo{
				StreamSessionID: stream.StreamSessionID,
				State:           stream.State,
			}
		}
	}

	return result, nil
}
