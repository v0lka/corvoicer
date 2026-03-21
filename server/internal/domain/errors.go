package domain

import "errors"

var (
	ErrRoomNotFound        = errors.New("room not found")
	ErrRoomClosed          = errors.New("room is closed")
	ErrRoomFull            = errors.New("room is full")
	ErrRoomExpired         = errors.New("room has expired")
	ErrInvalidInviteToken  = errors.New("invalid invite token")
	ErrStreamSlotOccupied  = errors.New("stream slot is already occupied")
	ErrStreamNotActive     = errors.New("no active stream in room")
	ErrNotBroadcaster      = errors.New("participant is not the broadcaster")
	ErrNotOwner            = errors.New("participant is not the room owner")
	ErrParticipantNotFound = errors.New("participant not found")
	ErrMessageDuplicate    = errors.New("message with this client_message_id already exists")
)
