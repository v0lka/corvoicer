package domain

import "time"

type Room struct {
	RoomID                 string     `json:"room_id"`
	InviteTokenHash        string     `json:"-"`
	Status                 string     `json:"status"`
	OwnerSessionID         string     `json:"owner_session_id"`
	ActiveStreamSessionID  *string    `json:"active_stream_session_id"`
	CreatedAt              time.Time  `json:"created_at"`
	ExpiresAt              time.Time  `json:"expires_at"`
}
