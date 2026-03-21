package handlers

import (
	"net/http"
	"strconv"

	"github.com/vkochetkov/corvoicer/server/internal/api"
	"github.com/vkochetkov/corvoicer/server/internal/service"
)

type MessageHandler struct {
	messageService *service.MessageService
}

func NewMessageHandler(messageService *service.MessageService) *MessageHandler {
	return &MessageHandler{messageService: messageService}
}

func (h *MessageHandler) Register(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/v1/rooms/{room_id}/messages", h.SendMessage)
	mux.HandleFunc("GET /api/v1/rooms/{room_id}/messages", h.GetMessages)
}

type sendMessageRequest struct {
	ParticipantSessionID string `json:"participant_session_id"`
	ClientMessageID      string `json:"client_message_id"`
	Text                 string `json:"text"`
}

func (h *MessageHandler) SendMessage(w http.ResponseWriter, r *http.Request) {
	roomID := r.PathValue("room_id")

	var req sendMessageRequest
	if err := api.DecodeJSON(r, &req); err != nil {
		api.WriteError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request body")
		return
	}

	if req.ParticipantSessionID == "" || req.ClientMessageID == "" || req.Text == "" {
		api.WriteError(w, http.StatusBadRequest, "MISSING_FIELDS", "participant_session_id, client_message_id, and text are required")
		return
	}

	result, err := h.messageService.SendMessage(r.Context(), roomID, req.ParticipantSessionID, req.ClientMessageID, req.Text)
	if err != nil {
		api.WriteError(w, http.StatusInternalServerError, "SEND_FAILED", "failed to persist message")
		return
	}

	api.WriteJSON(w, http.StatusCreated, result)
}

type getMessagesResponse struct {
	Messages []messageItem `json:"messages"`
}

type messageItem struct {
	MessageID            string `json:"message_id"`
	ParticipantSessionID string `json:"participant_session_id"`
	ClientMessageID      string `json:"client_message_id"`
	Text                 string `json:"text"`
	CreatedAt            string `json:"created_at"`
	DisplayName          string `json:"display_name"`
}

func (h *MessageHandler) GetMessages(w http.ResponseWriter, r *http.Request) {
	roomID := r.PathValue("room_id")

	limitStr := r.URL.Query().Get("limit")
	limit := 100
	if limitStr != "" {
		if l, err := strconv.Atoi(limitStr); err == nil && l > 0 && l <= 100 {
			limit = l
		}
	}

	beforeID := r.URL.Query().Get("before")

	messages, err := h.messageService.GetHistory(r.Context(), roomID, limit, beforeID)
	if err != nil {
		api.WriteError(w, http.StatusInternalServerError, "GET_MESSAGES_FAILED", "failed to get messages")
		return
	}

	items := make([]messageItem, 0, len(messages))
	for _, m := range messages {
		items = append(items, messageItem{
			MessageID:            m.MessageID,
			ParticipantSessionID: m.ParticipantSessionID,
			ClientMessageID:      m.ClientMessageID,
			Text:                 m.Text,
			CreatedAt:            api.FormatTime(m.CreatedAt),
			DisplayName:          m.DisplayName,
		})
	}

	api.WriteJSON(w, http.StatusOK, getMessagesResponse{Messages: items})
}
