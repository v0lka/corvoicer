package domain

import "time"

type ParticipantSession struct {
	ParticipantSessionID string     `json:"participant_session_id"`
	RoomID               string     `json:"room_id"`
	DisplayName          string     `json:"display_name"`
	Role                 string     `json:"role"`
	JoinedAt             time.Time  `json:"joined_at"`
	LeftAt               *time.Time `json:"left_at,omitempty"`
}
