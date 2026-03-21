package livekit

import (
	"context"
	"fmt"

	"github.com/livekit/protocol/livekit"
	lksdk "github.com/livekit/server-sdk-go"
)

type IngressService struct {
	client *lksdk.IngressClient
}

func NewIngressService(url, apiKey, apiSecret string) *IngressService {
	return &IngressService{
		client: lksdk.NewIngressClient(url, apiKey, apiSecret),
	}
}

type IngressResult struct {
	IngressID           string
	StreamKey           string
	URL                 string
	ParticipantIdentity string
}

func (s *IngressService) CreateWHIPIngress(ctx context.Context, roomID string) (*IngressResult, error) {
	participantIdentity := "stream:" + roomID

	req := &livekit.CreateIngressRequest{
		InputType:           livekit.IngressInput_WHIP_INPUT,
		Name:                "stream-" + roomID,
		RoomName:            roomID,
		ParticipantIdentity: participantIdentity,
		ParticipantName:     "Stream",
		BypassTranscoding:   true,
	}

	info, err := s.client.CreateIngress(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("create WHIP ingress: %w", err)
	}

	return &IngressResult{
		IngressID:           info.IngressId,
		StreamKey:           info.StreamKey,
		URL:                 info.Url,
		ParticipantIdentity: participantIdentity,
	}, nil
}

func (s *IngressService) DeleteIngress(ctx context.Context, ingressID string) error {
	_, err := s.client.DeleteIngress(ctx, &livekit.DeleteIngressRequest{
		IngressId: ingressID,
	})
	if err != nil {
		return fmt.Errorf("delete ingress %s: %w", ingressID, err)
	}
	return nil
}
