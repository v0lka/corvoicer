package main

import (
	"context"
	"embed"
	"errors"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/livekit/protocol/auth"
	"github.com/livekit/protocol/webhook"
	"github.com/vkochetkov/corvoicer/server/internal/api/handlers"
	"github.com/vkochetkov/corvoicer/server/internal/api/middleware"
	"github.com/vkochetkov/corvoicer/server/internal/config"
	"github.com/vkochetkov/corvoicer/server/internal/domain"
	lk "github.com/vkochetkov/corvoicer/server/internal/livekit"
	"github.com/vkochetkov/corvoicer/server/internal/repository/sqlite"
	"github.com/vkochetkov/corvoicer/server/internal/service"
)

//go:embed migrations/001_initial_schema.sql
var migration001 string

//go:embed migrations/002_drop_source_columns.sql
var migration002 string

//go:embed migrations/003_add_muted_by_owner.sql
var migration003 string

//go:embed all:dist
var webAssets embed.FS

func main() {
	cfg, err := config.Load()
	if err != nil {
		slog.Error("failed to load config", "error", err)
		os.Exit(1)
	}

	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: cfg.LogLevel(),
	}))
	slog.SetDefault(logger)

	// Database
	db, err := sqlite.Open(cfg.DatabasePath)
	if err != nil {
		slog.Error("failed to open database", "error", err)
		os.Exit(1)
	}
	defer db.Close()

	if err := sqlite.RunMigrations(db, []sqlite.NamedMigration{
		{Version: 1, Name: "initial_schema", SQL: migration001},
		{Version: 2, Name: "drop_source_columns", SQL: migration002},
		{Version: 3, Name: "add_muted_by_owner", SQL: migration003},
	}); err != nil {
		slog.Error("failed to run migrations", "error", err)
		os.Exit(1)
	}

	// Repositories
	roomRepo := sqlite.NewRoomRepo(db)
	participantRepo := sqlite.NewParticipantRepo(db)
	streamRepo := sqlite.NewStreamRepo(db)
	messageRepo := sqlite.NewMessageRepo(db)

	// LiveKit
	tokenService := lk.NewTokenService(cfg.LiveKitAPIKey, cfg.LiveKitAPISecret, cfg.LiveKitHost)
	ingressService := lk.NewIngressService(cfg.LiveKitHost, cfg.LiveKitAPIKey, cfg.LiveKitAPISecret)
	roomServiceClient := lk.NewRoomServiceClient(cfg.LiveKitHost, cfg.LiveKitAPIKey, cfg.LiveKitAPISecret)

	// Services
	inviteService := service.NewInviteService(cfg.InviteTokenSecret)
	roomService := service.NewRoomService(roomRepo, participantRepo, streamRepo, inviteService, roomServiceClient, ingressService, cfg.RoomDefaultTTL, cfg.RoomMaxParticipants)
	streamService := service.NewStreamService(roomRepo, streamRepo, ingressService, cfg.WHIPBaseURL)
	messageService := service.NewMessageService(messageRepo, cfg.ChatMaxPerRoom)

	// Router
	mux := http.NewServeMux()

	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"ok"}`))
	})

	// Register handlers
	roomHandler := handlers.NewRoomHandler(roomService, tokenService, cfg.AdminToken)
	roomHandler.Register(mux)

	streamHandler := handlers.NewStreamHandler(streamService)
	streamHandler.Register(mux)

	messageHandler := handlers.NewMessageHandler(messageService)
	messageHandler.Register(mux)

	// LiveKit webhook — handles ingress_ended events to clean up dead streams
	webhookKeyProvider := auth.NewSimpleKeyProvider(cfg.LiveKitAPIKey, cfg.LiveKitAPISecret)
	mux.HandleFunc("POST /api/v1/webhook/livekit", livekitWebhook(streamRepo, roomRepo, webhookKeyProvider))

	// SPA serving: embed built frontend assets
	distFS, err := fs.Sub(webAssets, "dist")
	if err != nil {
		slog.Error("failed to create sub filesystem for web assets", "error", err)
		os.Exit(1)
	}
	fileServer := http.FileServer(http.FS(distFS))
	mux.Handle("GET /", spaHandler(fileServer, distFS))

	// Middleware chain: recovery -> logger -> CORS -> router
	var handler http.Handler = mux
	handler = middleware.CORS(handler)
	handler = middleware.Logger(handler)
	handler = middleware.Recovery(handler)

	srv := &http.Server{
		Addr:         cfg.BindAddr + ":" + cfg.Port,
		Handler:      handler,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	// Background cleanup
	cleanup := sqlite.NewCleanupRunner(roomRepo, messageRepo)
	go cleanup.Start(ctx, 5*time.Minute, cfg.ChatRetentionDays)

	go func() {
		if cfg.TLSEnabled() {
			slog.Info("starting control-api server (HTTPS)", "addr", cfg.BindAddr, "port", cfg.Port)
			if err := srv.ListenAndServeTLS(cfg.TLSCertPath, cfg.TLSKeyPath); err != nil && err != http.ErrServerClosed {
				slog.Error("server error", "error", err)
				os.Exit(1)
			}
		} else {
			slog.Info("starting control-api server (HTTP)", "addr", cfg.BindAddr, "port", cfg.Port)
			if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
				slog.Error("server error", "error", err)
				os.Exit(1)
			}
		}
	}()

	<-ctx.Done()
	slog.Info("shutting down server")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		slog.Error("server shutdown error", "error", err)
	}

	slog.Info("server stopped")
}

func spaHandler(fileServer http.Handler, fsys fs.FS) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimPrefix(r.URL.Path, "/")
		if path == "" {
			fileServer.ServeHTTP(w, r)
			return
		}
		// Try to open the file; if it exists, serve it directly
		f, err := fsys.Open(path)
		if err != nil {
			// File not found — serve index.html for SPA client-side routing
			r.URL.Path = "/"
			fileServer.ServeHTTP(w, r)
			return
		}
		f.Close()
		fileServer.ServeHTTP(w, r)
	}
}

// livekitWebhook handles LiveKit webhook events.
// When an ingress ends unexpectedly (OBS crash, network loss), this cleans up
// the stream slot so the broadcaster can start a new stream.
func livekitWebhook(streamRepo *sqlite.StreamRepo, roomRepo *sqlite.RoomRepo, provider *auth.SimpleKeyProvider) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Verify webhook signature before processing
		event, err := webhook.ReceiveWebhookEvent(r, provider)
		if err != nil {
			slog.Error("webhook: signature validation failed", "error", err)
			w.WriteHeader(http.StatusOK) // 200 to avoid LiveKit retries
			return
		}

		if event.Event != "ingress_ended" {
			w.WriteHeader(http.StatusOK)
			return
		}

		ingress := event.IngressInfo
		if ingress == nil || ingress.ParticipantIdentity == "" {
			w.WriteHeader(http.StatusOK)
			return
		}

		// Extract room ID from "stream:<room_id>" identity
		if !strings.HasPrefix(ingress.ParticipantIdentity, "stream:") {
			w.WriteHeader(http.StatusOK)
			return
		}
		roomID := strings.TrimPrefix(ingress.ParticipantIdentity, "stream:")

		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()

		// Look up the stream session by ingress ID
		stream, err := streamRepo.GetByIngressID(ctx, ingress.IngressId)
		if err != nil {
			if !errors.Is(err, domain.ErrStreamNotActive) {
				slog.Error("webhook: failed to find stream by ingress", "ingress_id", ingress.IngressId, "error", err)
			}
			w.WriteHeader(http.StatusOK)
			return
		}

		if err := streamRepo.End(ctx, stream.StreamSessionID); err != nil {
			slog.Error("webhook: failed to end stream", "stream_session_id", stream.StreamSessionID, "error", err)
		}
		if err := roomRepo.SetActiveStream(ctx, roomID, nil); err != nil {
			slog.Error("webhook: failed to clear active stream", "room_id", roomID, "error", err)
		}

		slog.Info("webhook: cleaned up dead stream", "room_id", roomID, "ingress_id", ingress.IngressId, "stream_session_id", stream.StreamSessionID)
		w.WriteHeader(http.StatusOK)
	}
}
