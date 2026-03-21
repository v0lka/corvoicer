package handlers

import (
	"errors"
	"log/slog"
	"net/http"

	"github.com/vkochetkov/corvoicer/server/internal/api"
	"github.com/vkochetkov/corvoicer/server/internal/domain"
	"github.com/vkochetkov/corvoicer/server/internal/service"
)

type StreamHandler struct {
	streamService *service.StreamService
}

func NewStreamHandler(streamService *service.StreamService) *StreamHandler {
	return &StreamHandler{streamService: streamService}
}

func (h *StreamHandler) Register(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/v1/rooms/{room_id}/stream/start", h.StartStream)
	mux.HandleFunc("POST /api/v1/rooms/{room_id}/stream/stop", h.StopStream)
}

type startStreamRequest struct {
	ParticipantSessionID string `json:"participant_session_id"`
}

func (h *StreamHandler) StartStream(w http.ResponseWriter, r *http.Request) {
	roomID := r.PathValue("room_id")

	var req startStreamRequest
	if err := api.DecodeJSON(r, &req); err != nil {
		api.WriteError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request body")
		return
	}

	if req.ParticipantSessionID == "" {
		api.WriteError(w, http.StatusBadRequest, "MISSING_SESSION_ID", "participant_session_id is required")
		return
	}

	result, err := h.streamService.StartStream(r.Context(), roomID, req.ParticipantSessionID)
	if err != nil {
		if errors.Is(err, domain.ErrNotOwner) {
			api.WriteError(w, http.StatusForbidden, "NOT_OWNER", "only the room owner can start a stream")
			return
		}
		if errors.Is(err, domain.ErrStreamSlotOccupied) {
			api.WriteError(w, http.StatusConflict, "STREAM_SLOT_OCCUPIED", "another stream is already active in this room")
			return
		}
		if errors.Is(err, domain.ErrRoomNotFound) {
			api.WriteError(w, http.StatusNotFound, "ROOM_NOT_FOUND", "room not found")
			return
		}
		// Log the actual error for debugging
		slog.Error("failed to start stream", "error", err, "room_id", roomID)
		api.WriteError(w, http.StatusInternalServerError, "START_STREAM_FAILED", "failed to start stream")
		return
	}

	api.WriteJSON(w, http.StatusOK, result)
}

type stopStreamRequest struct {
	ParticipantSessionID string `json:"participant_session_id"`
	StreamSessionID      string `json:"stream_session_id"`
}

func (h *StreamHandler) StopStream(w http.ResponseWriter, r *http.Request) {
	roomID := r.PathValue("room_id")

	var req stopStreamRequest
	if err := api.DecodeJSON(r, &req); err != nil {
		api.WriteError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request body")
		return
	}

	if req.ParticipantSessionID == "" || req.StreamSessionID == "" {
		api.WriteError(w, http.StatusBadRequest, "MISSING_FIELDS", "participant_session_id and stream_session_id are required")
		return
	}

	if err := h.streamService.StopStream(r.Context(), roomID, req.ParticipantSessionID, req.StreamSessionID); err != nil {
		if errors.Is(err, domain.ErrNotBroadcaster) {
			api.WriteError(w, http.StatusForbidden, "NOT_BROADCASTER", "only the broadcaster can stop the stream")
			return
		}
		if errors.Is(err, domain.ErrStreamNotActive) {
			api.WriteError(w, http.StatusNotFound, "STREAM_NOT_FOUND", "stream session not found")
			return
		}
		api.WriteError(w, http.StatusInternalServerError, "STOP_STREAM_FAILED", "failed to stop stream")
		return
	}

	api.WriteJSON(w, http.StatusOK, map[string]bool{"stopped": true})
}
