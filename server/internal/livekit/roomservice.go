package livekit

import (
	"context"
	"fmt"

	"github.com/livekit/protocol/livekit"
	lksdk "github.com/livekit/server-sdk-go"
)

type RoomServiceClient struct {
	client *lksdk.RoomServiceClient
}

func NewRoomServiceClient(url, apiKey, apiSecret string) *RoomServiceClient {
	client := lksdk.NewRoomServiceClient(url, apiKey, apiSecret)
	return &RoomServiceClient{client: client}
}

func (c *RoomServiceClient) MuteParticipantTrack(ctx context.Context, roomName, identity string, muted bool) error {
	participants, err := c.client.ListParticipants(ctx, &livekit.ListParticipantsRequest{
		Room: roomName,
	})
	if err != nil {
		return fmt.Errorf("list participants in room %s: %w", roomName, err)
	}

	var targetParticipant *livekit.ParticipantInfo
	for _, p := range participants.Participants {
		if p.Identity == identity {
			targetParticipant = p
			break
		}
	}

	if targetParticipant == nil {
		return fmt.Errorf("participant %s not found in room %s", identity, roomName)
	}

	var audioTrackID string
	for _, track := range targetParticipant.Tracks {
		if track.Source == livekit.TrackSource_MICROPHONE {
			audioTrackID = track.Sid
			break
		}
	}

	if audioTrackID == "" {
		return fmt.Errorf("no microphone track found for participant %s", identity)
	}

	_, err = c.client.MutePublishedTrack(ctx, &livekit.MuteRoomTrackRequest{
		Room:     roomName,
		Identity: identity,
		TrackSid: audioTrackID,
		Muted:    muted,
	})
	if err != nil {
		return fmt.Errorf("mute track %s for participant %s: %w", audioTrackID, identity, err)
	}

	return nil
}

func (c *RoomServiceClient) UpdateParticipantMetadata(ctx context.Context, roomName, identity string, metadata string) error {
	_, err := c.client.UpdateParticipant(ctx, &livekit.UpdateParticipantRequest{
		Room:     roomName,
		Identity: identity,
		Metadata: metadata,
	})
	if err != nil {
		return fmt.Errorf("update metadata for participant %s in room %s: %w", identity, roomName, err)
	}
	return nil
}
