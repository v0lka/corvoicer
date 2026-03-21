package config

import (
	"fmt"
	"log/slog"
	"os"
	"time"
)

type Config struct {
	Port                string
	BindAddr            string
	TLSCertPath         string
	TLSKeyPath          string
	DatabasePath        string
	LiveKitHost         string
	LiveKitAPIKey       string
	LiveKitAPISecret    string
	WHIPBaseURL         string
	InviteTokenSecret   string
	AdminToken          string
	RoomDefaultTTL      time.Duration
	RoomMaxParticipants int
	ChatRetentionDays   int
	ChatMaxPerRoom      int
	LogLevelStr         string
}

// TLSEnabled returns true if both certificate and key paths are configured
func (c *Config) TLSEnabled() bool {
	return c.TLSCertPath != "" && c.TLSKeyPath != ""
}

func Load() (*Config, error) {
	cfg := &Config{
		Port:                getEnv("SERVER_PORT", "8080"),
		BindAddr:            getEnv("BIND_ADDR", "127.0.0.1"),
		TLSCertPath:         getEnv("TLS_CERT_PATH", ""),
		TLSKeyPath:          getEnv("TLS_KEY_PATH", ""),
		DatabasePath:        getEnv("DATABASE_PATH", "./corvoicer.db"),
		LiveKitHost:         getEnv("LIVEKIT_HOST", "ws://localhost:7880"),
		LiveKitAPIKey:       getEnv("LIVEKIT_API_KEY", "devkey"),
		LiveKitAPISecret:    getEnv("LIVEKIT_API_SECRET", "devsecret"),
		WHIPBaseURL:         getEnv("WHIP_BASE_URL", ""),
		InviteTokenSecret:   getEnv("INVITE_TOKEN_SECRET", ""),
		AdminToken:          getEnv("ADMIN_TOKEN", ""),
		RoomMaxParticipants: 16,
		ChatRetentionDays:   30,
		ChatMaxPerRoom:      5000,
		LogLevelStr:         getEnv("LOG_LEVEL", "info"),
	}

	ttlStr := getEnv("ROOM_DEFAULT_TTL", "24h")
	ttl, err := time.ParseDuration(ttlStr)
	if err != nil {
		return nil, fmt.Errorf("invalid ROOM_DEFAULT_TTL %q: %w", ttlStr, err)
	}
	cfg.RoomDefaultTTL = ttl

	if cfg.InviteTokenSecret == "" {
		return nil, fmt.Errorf("INVITE_TOKEN_SECRET is required")
	}
	if len(cfg.InviteTokenSecret) < 32 {
		return nil, fmt.Errorf("INVITE_TOKEN_SECRET must be at least 32 bytes")
	}

	if cfg.AdminToken == "" {
		return nil, fmt.Errorf("ADMIN_TOKEN is required")
	}
	if len(cfg.AdminToken) < 8 {
		return nil, fmt.Errorf("ADMIN_TOKEN must be at least 8 characters")
	}

	return cfg, nil
}

func (c *Config) LogLevel() slog.Level {
	switch c.LogLevelStr {
	case "debug":
		return slog.LevelDebug
	case "warn":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
