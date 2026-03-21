package service

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/vkochetkov/corvoicer/server/internal/domain"
)

type InviteService struct {
	secret []byte
}

func NewInviteService(secret string) *InviteService {
	return &InviteService{secret: []byte(secret)}
}

// GenerateToken creates a signed invite token for a room.
// Format: base64url(roomID:expiresUnix:hmacSignature)
func (s *InviteService) GenerateToken(roomID string, expiresAt time.Time) string {
	payload := roomID + ":" + strconv.FormatInt(expiresAt.Unix(), 10)
	sig := s.sign(payload)
	raw := payload + ":" + base64.RawURLEncoding.EncodeToString(sig)
	return base64.RawURLEncoding.EncodeToString([]byte(raw))
}

// ValidateToken verifies and parses an invite token.
// Returns the roomID if valid.
func (s *InviteService) ValidateToken(token string) (string, error) {
	raw, err := base64.RawURLEncoding.DecodeString(token)
	if err != nil {
		return "", domain.ErrInvalidInviteToken
	}

	parts := strings.SplitN(string(raw), ":", 3)
	if len(parts) != 3 {
		return "", domain.ErrInvalidInviteToken
	}

	roomID := parts[0]
	expiresStr := parts[1]
	sigB64 := parts[2]

	expiresUnix, err := strconv.ParseInt(expiresStr, 10, 64)
	if err != nil {
		return "", domain.ErrInvalidInviteToken
	}

	if time.Now().UTC().Unix() > expiresUnix {
		return "", fmt.Errorf("%w: token expired", domain.ErrInvalidInviteToken)
	}

	sig, err := base64.RawURLEncoding.DecodeString(sigB64)
	if err != nil {
		return "", domain.ErrInvalidInviteToken
	}

	payload := roomID + ":" + expiresStr
	expected := s.sign(payload)

	if !hmac.Equal(sig, expected) {
		return "", domain.ErrInvalidInviteToken
	}

	return roomID, nil
}

// HashToken returns a SHA-256 hash of the token for storage lookup.
func (s *InviteService) HashToken(token string) string {
	h := sha256.Sum256([]byte(token))
	return base64.RawURLEncoding.EncodeToString(h[:])
}

func (s *InviteService) sign(payload string) []byte {
	mac := hmac.New(sha256.New, s.secret)
	mac.Write([]byte(payload))
	return mac.Sum(nil)
}
