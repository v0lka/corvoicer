package handlers

import (
	"crypto/subtle"
	"errors"
	"net/http"

	"github.com/vkochetkov/corvoicer/server/internal/api"
	"github.com/vkochetkov/corvoicer/server/internal/domain"
	"github.com/vkochetkov/corvoicer/server/internal/service"
)

type RoomHandler struct {
	roomService *service.RoomService
	livekit     LiveKitTokenIssuer
	adminToken  string
}

type LiveKitTokenIssuer interface {
	GenerateToken(roomID string, participantID string, displayName string) (string, error)
	GetURL() string
}

func NewRoomHandler(roomService *service.RoomService, livekit LiveKitTokenIssuer, adminToken string) *RoomHandler {
	return &RoomHandler{roomService: roomService, livekit: livekit, adminToken: adminToken}
}

func (h *RoomHandler) Register(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/v1/rooms", h.CreateRoom)
	mux.HandleFunc("POST /api/v1/rooms/join", h.JoinRoom)
	mux.HandleFunc("POST /api/v1/rooms/rejoin", h.RejoinRoom)
	mux.HandleFunc("GET /api/v1/rooms/{room_id}", h.GetRoom)
	mux.HandleFunc("POST /api/v1/rooms/{room_id}/leave", h.LeaveRoom)
	mux.HandleFunc("POST /api/v1/rooms/{room_id}/participants/{participant_session_id}/mute", h.MuteParticipant)
	mux.HandleFunc("POST /api/v1/auth/validate-admin-token", h.ValidateAdminToken)
}

type createRoomRequest struct {
	OwnerDisplayName string `json:"owner_display_name"`
	AdminToken       string `json:"admin_token"`
}

type createRoomResponse struct {
	RoomID         string `json:"room_id"`
	InviteToken    string `json:"invite_token"`
	InviteURL      string `json:"invite_url"`
	OwnerSessionID string `json:"owner_session_id"`
	LiveKitToken   string `json:"livekit_token"`
	LiveKitURL     string `json:"livekit_url"`
}

func (h *RoomHandler) CreateRoom(w http.ResponseWriter, r *http.Request) {
	var req createRoomRequest
	if err := api.DecodeJSON(r, &req); err != nil {
		api.WriteError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request body")
		return
	}

	if req.OwnerDisplayName == "" || len(req.OwnerDisplayName) > 50 {
		api.WriteError(w, http.StatusBadRequest, "INVALID_DISPLAY_NAME", "display_name must be 1-50 characters")
		return
	}

	if subtle.ConstantTimeCompare([]byte(req.AdminToken), []byte(h.adminToken)) != 1 {
		api.WriteError(w, http.StatusForbidden, "INVALID_ADMIN_TOKEN", "invalid admin token")
		return
	}

	result, err := h.roomService.CreateRoom(r.Context(), req.OwnerDisplayName)
	if err != nil {
		api.WriteError(w, http.StatusInternalServerError, "CREATE_ROOM_FAILED", "failed to create room")
		return
	}

	lkToken, err := h.livekit.GenerateToken(result.RoomID, result.OwnerSessionID, req.OwnerDisplayName)
	if err != nil {
		api.WriteError(w, http.StatusInternalServerError, "TOKEN_GENERATION_FAILED", "failed to generate LiveKit token")
		return
	}

	api.WriteJSON(w, http.StatusCreated, createRoomResponse{
		RoomID:         result.RoomID,
		InviteToken:    result.InviteToken,
		InviteURL:      result.InviteURL,
		OwnerSessionID: result.OwnerSessionID,
		LiveKitToken:   lkToken,
		LiveKitURL:     h.livekit.GetURL(),
	})
}

type joinRoomRequest struct {
	InviteToken string `json:"invite_token"`
	DisplayName string `json:"display_name"`
}

type joinRoomResponse struct {
	RoomID               string      `json:"room_id"`
	ParticipantSessionID string      `json:"participant_session_id"`
	LiveKitToken         string      `json:"livekit_token"`
	LiveKitURL           string      `json:"livekit_url"`
	Role                 string      `json:"role"`
	MutedByOwner         bool        `json:"muted_by_owner"`
	ActiveStream         *streamInfo `json:"active_stream,omitempty"`
}

func (h *RoomHandler) JoinRoom(w http.ResponseWriter, r *http.Request) {
	var req joinRoomRequest
	if err := api.DecodeJSON(r, &req); err != nil {
		api.WriteError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request body")
		return
	}

	if req.InviteToken == "" {
		api.WriteError(w, http.StatusBadRequest, "MISSING_TOKEN", "invite_token is required")
		return
	}
	if req.DisplayName == "" || len(req.DisplayName) > 50 {
		api.WriteError(w, http.StatusBadRequest, "INVALID_DISPLAY_NAME", "display_name must be 1-50 characters")
		return
	}

	result, err := h.roomService.JoinRoom(r.Context(), req.InviteToken, req.DisplayName)
	if err != nil {
		if errors.Is(err, domain.ErrInvalidInviteToken) {
			api.WriteError(w, http.StatusUnauthorized, "INVALID_TOKEN", "invalid or expired invite token")
			return
		}
		if errors.Is(err, domain.ErrRoomClosed) || errors.Is(err, domain.ErrRoomExpired) {
			api.WriteError(w, http.StatusGone, "ROOM_UNAVAILABLE", "room is no longer available")
			return
		}
		if errors.Is(err, domain.ErrRoomFull) {
			api.WriteError(w, http.StatusConflict, "ROOM_FULL", "room has reached maximum participants")
			return
		}
		api.WriteError(w, http.StatusInternalServerError, "JOIN_FAILED", "failed to join room")
		return
	}

	lkToken, err := h.livekit.GenerateToken(result.RoomID, result.ParticipantSessionID, req.DisplayName)
	if err != nil {
		api.WriteError(w, http.StatusInternalServerError, "TOKEN_GENERATION_FAILED", "failed to generate LiveKit token")
		return
	}

	resp := joinRoomResponse{
		RoomID:               result.RoomID,
		ParticipantSessionID: result.ParticipantSessionID,
		LiveKitToken:         lkToken,
		LiveKitURL:           h.livekit.GetURL(),
		Role:                 result.Role,
		MutedByOwner:         false,
	}
	if result.ActiveStream != nil {
		resp.ActiveStream = &streamInfo{
			StreamSessionID: result.ActiveStream.StreamSessionID,
			State:           result.ActiveStream.State,
		}
	}
	api.WriteJSON(w, http.StatusOK, resp)
}

type rejoinRoomRequest struct {
	ParticipantSessionID string `json:"participant_session_id"`
}

type rejoinRoomResponse struct {
	RoomID               string      `json:"room_id"`
	ParticipantSessionID string      `json:"participant_session_id"`
	LiveKitToken         string      `json:"livekit_token"`
	LiveKitURL           string      `json:"livekit_url"`
	Role                 string      `json:"role"`
	DisplayName          string      `json:"display_name"`
	MutedByOwner         bool        `json:"muted_by_owner"`
	ActiveStream         *streamInfo `json:"active_stream,omitempty"`
}

type streamInfo struct {
	StreamSessionID string `json:"stream_session_id"`
	State           string `json:"state"`
}

func (h *RoomHandler) RejoinRoom(w http.ResponseWriter, r *http.Request) {
	var req rejoinRoomRequest
	if err := api.DecodeJSON(r, &req); err != nil {
		api.WriteError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request body")
		return
	}

	if req.ParticipantSessionID == "" {
		api.WriteError(w, http.StatusBadRequest, "MISSING_SESSION_ID", "participant_session_id is required")
		return
	}

	result, err := h.roomService.RejoinRoom(r.Context(), req.ParticipantSessionID)
	if err != nil {
		if errors.Is(err, domain.ErrParticipantNotFound) {
			api.WriteError(w, http.StatusNotFound, "PARTICIPANT_NOT_FOUND", "participant not found")
			return
		}
		if errors.Is(err, domain.ErrRoomNotFound) {
			api.WriteError(w, http.StatusNotFound, "ROOM_NOT_FOUND", "room not found")
			return
		}
		if errors.Is(err, domain.ErrRoomClosed) {
			api.WriteError(w, http.StatusGone, "ROOM_UNAVAILABLE", "room is no longer available")
			return
		}
		if errors.Is(err, domain.ErrRoomExpired) {
			api.WriteError(w, http.StatusGone, "ROOM_EXPIRED", "room has expired")
			return
		}
		api.WriteError(w, http.StatusInternalServerError, "REJOIN_FAILED", "failed to rejoin room")
		return
	}

	lkToken, err := h.livekit.GenerateToken(result.RoomID, result.ParticipantSessionID, result.DisplayName)
	if err != nil {
		api.WriteError(w, http.StatusInternalServerError, "TOKEN_GENERATION_FAILED", "failed to generate LiveKit token")
		return
	}

	resp := rejoinRoomResponse{
		RoomID:               result.RoomID,
		ParticipantSessionID: result.ParticipantSessionID,
		LiveKitToken:         lkToken,
		LiveKitURL:           h.livekit.GetURL(),
		Role:                 result.Role,
		DisplayName:          result.DisplayName,
		MutedByOwner:         result.MutedByOwner,
	}
	if result.ActiveStream != nil {
		resp.ActiveStream = &streamInfo{
			StreamSessionID: result.ActiveStream.StreamSessionID,
			State:           result.ActiveStream.State,
		}
	}
	api.WriteJSON(w, http.StatusOK, resp)
}

func (h *RoomHandler) GetRoom(w http.ResponseWriter, r *http.Request) {
	roomID := r.PathValue("room_id")
	if roomID == "" {
		api.WriteError(w, http.StatusBadRequest, "MISSING_ROOM_ID", "room_id is required")
		return
	}

	info, err := h.roomService.GetRoomInfo(r.Context(), roomID)
	if err != nil {
		if errors.Is(err, domain.ErrRoomNotFound) {
			api.WriteError(w, http.StatusNotFound, "ROOM_NOT_FOUND", "room not found")
			return
		}
		api.WriteError(w, http.StatusInternalServerError, "GET_ROOM_FAILED", "failed to get room info")
		return
	}

	api.WriteJSON(w, http.StatusOK, info)
}

type leaveRoomRequest struct {
	ParticipantSessionID string `json:"participant_session_id"`
}

func (h *RoomHandler) LeaveRoom(w http.ResponseWriter, r *http.Request) {
	var req leaveRoomRequest
	if err := api.DecodeJSON(r, &req); err != nil {
		api.WriteError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request body")
		return
	}

	if req.ParticipantSessionID == "" {
		api.WriteError(w, http.StatusBadRequest, "MISSING_SESSION_ID", "participant_session_id is required")
		return
	}

	if err := h.roomService.LeaveRoom(r.Context(), req.ParticipantSessionID); err != nil {
		if errors.Is(err, domain.ErrParticipantNotFound) {
			api.WriteError(w, http.StatusNotFound, "PARTICIPANT_NOT_FOUND", "participant not found")
			return
		}
		api.WriteError(w, http.StatusInternalServerError, "LEAVE_FAILED", "failed to leave room")
		return
	}

	api.WriteJSON(w, http.StatusOK, map[string]bool{"left": true})
}

type validateAdminTokenRequest struct {
	AdminToken string `json:"admin_token"`
}

func (h *RoomHandler) ValidateAdminToken(w http.ResponseWriter, r *http.Request) {
	var req validateAdminTokenRequest
	if err := api.DecodeJSON(r, &req); err != nil {
		api.WriteError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request body")
		return
	}

	valid := subtle.ConstantTimeCompare([]byte(req.AdminToken), []byte(h.adminToken)) == 1
	api.WriteJSON(w, http.StatusOK, map[string]bool{"valid": valid})
}

type muteParticipantRequest struct {
	ParticipantSessionID string `json:"participant_session_id"` // requester
	Muted                bool   `json:"muted"`
}

func (h *RoomHandler) MuteParticipant(w http.ResponseWriter, r *http.Request) {
	roomID := r.PathValue("room_id")
	if roomID == "" {
		api.WriteError(w, http.StatusBadRequest, "MISSING_ROOM_ID", "room_id is required")
		return
	}

	targetSessionID := r.PathValue("participant_session_id")
	if targetSessionID == "" {
		api.WriteError(w, http.StatusBadRequest, "MISSING_PARTICIPANT_ID", "participant_session_id is required")
		return
	}

	var req muteParticipantRequest
	if err := api.DecodeJSON(r, &req); err != nil {
		api.WriteError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request body")
		return
	}

	if req.ParticipantSessionID == "" {
		api.WriteError(w, http.StatusBadRequest, "MISSING_REQUESTER_ID", "participant_session_id (requester) is required")
		return
	}

	if err := h.roomService.MuteParticipant(r.Context(), roomID, req.ParticipantSessionID, targetSessionID, req.Muted); err != nil {
		if errors.Is(err, domain.ErrNotOwner) {
			api.WriteError(w, http.StatusForbidden, "NOT_OWNER", "only room owner can mute participants")
			return
		}
		if errors.Is(err, domain.ErrRoomNotFound) {
			api.WriteError(w, http.StatusNotFound, "ROOM_NOT_FOUND", "room not found")
			return
		}
		if errors.Is(err, domain.ErrParticipantNotFound) {
			api.WriteError(w, http.StatusNotFound, "PARTICIPANT_NOT_FOUND", "participant not found")
			return
		}
		api.WriteError(w, http.StatusInternalServerError, "MUTE_FAILED", "failed to mute participant")
		return
	}

	api.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
