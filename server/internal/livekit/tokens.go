package livekit

import (
	"time"

	lksdk "github.com/livekit/server-sdk-go"
	"github.com/livekit/protocol/auth"
)

type TokenService struct {
	apiKey    string
	apiSecret string
	url       string
}

func NewTokenService(apiKey, apiSecret, url string) *TokenService {
	return &TokenService{apiKey: apiKey, apiSecret: apiSecret, url: url}
}

func (s *TokenService) GenerateToken(roomID string, participantID string, displayName string) (string, error) {
	at := auth.NewAccessToken(s.apiKey, s.apiSecret)
	grant := &auth.VideoGrant{
		RoomJoin: true,
		Room:     roomID,
	}

	at.AddGrant(grant).
		SetIdentity(participantID).
		SetName(displayName).
		SetValidFor(time.Hour)

	return at.ToJWT()
}

func (s *TokenService) GetURL() string {
	return s.url
}

func (s *TokenService) NewRoomServiceClient() *lksdk.RoomServiceClient {
	return lksdk.NewRoomServiceClient(s.url, s.apiKey, s.apiSecret)
}
