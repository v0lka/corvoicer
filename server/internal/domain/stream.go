package domain

import "time"

type StreamSession struct {
	StreamSessionID            string     `json:"stream_session_id"`
	RoomID                     string     `json:"room_id"`
	ParticipantSessionID       string     `json:"participant_session_id"`
	State                      string     `json:"state"`
	IngressID                  *string    `json:"ingress_id,omitempty"`
	IngressParticipantIdentity *string    `json:"ingress_participant_identity,omitempty"`
	StartedAt                  time.Time  `json:"started_at"`
	EndedAt                    *time.Time `json:"ended_at,omitempty"`
}
