package domain

import "time"

type ChatMessage struct {
	MessageID            string    `json:"message_id"`
	RoomID               string    `json:"room_id"`
	ParticipantSessionID string    `json:"participant_session_id"`
	ClientMessageID      string    `json:"client_message_id"`
	Text                 string    `json:"text"`
	CreatedAt            time.Time `json:"created_at"`
	DisplayName          string    `json:"-"` // populated from participant_sessions on read
}
