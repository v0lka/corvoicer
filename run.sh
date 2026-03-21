#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log() { echo -e "${GREEN}[+]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
error() { echo -e "${RED}[-]${NC} $*" >&2; }

# PIDs to track for cleanup
PIDS=()
cleanup() {
    log "Shutting down..."
    
    # Stop background processes
    for pid in "${PIDS[@]}"; do
        if kill -0 "$pid" 2>/dev/null; then
            kill "$pid" 2>/dev/null || true
        fi
    done
    exit 0
}
trap cleanup SIGINT SIGTERM

usage() {
    cat <<EOF
Usage: $0 [options]

Options:
    -a, --all           Start all components (default)
    -i, --infra         Start only infrastructure (Redis, LiveKit, Ingress)
    -s, --server        Start only the control-api server
    -f, --frontend      Start only the Vite frontend dev server
    -h, --help          Show this help message

Environment variables:
    DEV_HOST_IP              Host IP for LAN access (default: 127.0.0.1)
    USE_HTTPS                Enable HTTPS for all services (default: true)
    TLS_CERT_PATH            Path to TLS certificate (default: ./.cert/livekit-cert.pem)
    TLS_KEY_PATH             Path to TLS key (default: ./.cert/livekit-key.pem)
    SERVER_PORT              Control API port (default: 8080)
    DATABASE_PATH            SQLite database path (default: ./server/corvoicer.db)
    LIVEKIT_HOST             LiveKit server URL (auto: wss://DEV_HOST_IP:7880 when USE_HTTPS=true)
    LIVEKIT_API_KEY          LiveKit API key (default: devkey)
    LIVEKIT_API_SECRET       LiveKit API secret (default: secret-dev-key-min-32-characters!!)
    INVITE_TOKEN_SECRET      JWT secret for invites (default: invite-secret-dev-key-min-32-chars!!)
    ADMIN_TOKEN              Admin token for room creation (default: admin-dev-token-12345)
    LOG_LEVEL                Logging level: debug, info, warn, error (default: debug)

Requirements:
    - Redis: brew install redis
    - LiveKit: Download from https://github.com/livekit/livekit/releases
    - Ingress: built from source (see SETUP.md)
    - Go: brew install go
    - Node.js: brew install node

EOF
    exit 0
}

# Development host IP - set to your machine's LAN IP for multi-host testing
# Example: DEV_HOST_IP=192.168.1.53 ./run.sh
export DEV_HOST_IP="${DEV_HOST_IP:-127.0.0.1}"

# TLS/HTTPS configuration - set to true to enable HTTPS for all services
export USE_HTTPS="${USE_HTTPS:-true}"
export TLS_CERT_PATH="${TLS_CERT_PATH:-$SCRIPT_DIR/.cert/livekit-cert.pem}"
export TLS_KEY_PATH="${TLS_KEY_PATH:-$SCRIPT_DIR/.cert/livekit-key.pem}"

# Default environment variables for local development
export DATABASE_PATH="${DATABASE_PATH:-$SCRIPT_DIR/server/corvoicer.db}"

# LiveKit WebSocket URL (WSS when HTTPS is enabled)
# Note: LiveKit runs without TLS (ws://) - it doesn't support direct TLS configuration.
# For production, use a reverse proxy (Caddy/Nginx) for WSS termination.
export LIVEKIT_HOST="${LIVEKIT_HOST:-ws://$DEV_HOST_IP:7880}"

# LiveKit WebSocket URL for Vite proxy (used when frontend is on HTTPS but LiveKit is on WS)
export VITE_LIVEKIT_HOST="${VITE_LIVEKIT_HOST:-ws://$DEV_HOST_IP:7880}"

export LIVEKIT_API_KEY="${LIVEKIT_API_KEY:-devkey}"
export LIVEKIT_API_SECRET="${LIVEKIT_API_SECRET:-secret-dev-key-min-32-characters!!}"
export INVITE_TOKEN_SECRET="${INVITE_TOKEN_SECRET:-invite-secret-dev-key-min-32-chars!!}"
export ADMIN_TOKEN="${ADMIN_TOKEN:-admin-dev-token-12345}"
export ROOM_DEFAULT_TTL="${ROOM_DEFAULT_TTL:-24h}"
export SERVER_PORT="${SERVER_PORT:-8080}"
export LOG_LEVEL="${LOG_LEVEL:-debug}"

wait_for_port() {
    local port=$1
    local timeout=${2:-30}
    local start_time=$(date +%s)
    
    while ! nc -z localhost "$port" 2>/dev/null; do
        local elapsed=$(($(date +%s) - start_time))
        if [[ $elapsed -ge $timeout ]]; then
            error "Timeout waiting for port $port"
            return 1
        fi
        sleep 0.5
    done
    return 0
}

kill_port() {
    local port=$1
    local stale_pid
    stale_pid=$(lsof -ti :"$port" 2>/dev/null || true)
    if [[ -n "$stale_pid" ]]; then
        warn "Killing stale process on port $port (PID $stale_pid)..."
        kill "$stale_pid" 2>/dev/null || true
        sleep 1
        if kill -0 "$stale_pid" 2>/dev/null; then
            kill -9 "$stale_pid" 2>/dev/null || true
        fi
    fi
}

start_redis() {
    log "Starting Redis..."
    
    if ! command -v redis-server >/dev/null 2>&1; then
        error "redis-server not found. Install with: brew install redis"
        exit 1
    fi
    
    kill_port 6379
    
    redis-server --port 6379 --daemonize yes --save "" --appendonly no
    
    if wait_for_port 6379 10; then
        log "Redis is ready on port 6379"
    else
        error "Redis failed to start"
        exit 1
    fi
}

start_livekit() {
    log "Starting LiveKit server..."
    
    if ! command -v livekit-server >/dev/null 2>&1; then
        error "livekit-server not found. Download from: https://github.com/livekit/livekit/releases"
        error "Or install with: brew install livekit"
        exit 1
    fi
    
    kill_port 7880
    kill_port 7881
    
    # Note: LiveKit server does not support direct TLS configuration.
    # For HTTPS/WSS, use a reverse proxy (Caddy/Nginx) or run behind a load balancer.
    # For local LAN development, we run without TLS - the Ingress and control-api handle HTTPS.
    livekit-server --config "$SCRIPT_DIR/deploy/config/livekit.yaml" --dev &
    PIDS+=($!)
    
    if wait_for_port 7880 30; then
        log "LiveKit is ready on port 7880"
    else
        error "LiveKit failed to start"
        exit 1
    fi
}

start_ingress() {
    log "Starting LiveKit Ingress..."
    
    if ! command -v ingress >/dev/null 2>&1; then
        error "ingress binary not found. Build and install from source (see SETUP.md)."
        exit 1
    fi
    
    kill_port 7985
    
    export INGRESS_CONFIG_FILE="$SCRIPT_DIR/deploy/config/ingress.yaml"
    ingress &
    PIDS+=($!)
    
    if wait_for_port 7985 30; then
        log "LiveKit Ingress is ready on port 7985"
    else
        error "LiveKit Ingress failed to start"
        exit 1
    fi
}

start_server() {
    log "Building control-api server..."

    if ! command -v go >/dev/null 2>&1; then
        error "go not found. Install with: brew install go"
        exit 1
    fi

    kill_port "$SERVER_PORT"

    (cd server && go build -o server ./cmd/server/)

    # Bind to all interfaces when DEV_HOST_IP is set for LAN access
    local bind_addr="127.0.0.1"
    if [[ "$DEV_HOST_IP" != "127.0.0.1" ]]; then
        bind_addr="0.0.0.0"
    fi

    # Set TLS config for HTTPS
    local tls_cert_arg=""
    local tls_key_arg=""
    local protocol="HTTP"
    if [[ "$USE_HTTPS" == "true" ]]; then
        tls_cert_arg="$TLS_CERT_PATH"
        tls_key_arg="$TLS_KEY_PATH"
        protocol="HTTPS"
    fi

    log "Starting control-api server on $bind_addr:$SERVER_PORT ($protocol)..."
    (cd server && BIND_ADDR="$bind_addr" TLS_CERT_PATH="$tls_cert_arg" TLS_KEY_PATH="$tls_key_arg" ./server) &
    PIDS+=($!)

    if wait_for_port "$SERVER_PORT" 30; then
        log "Control-api server is ready on port $SERVER_PORT"
    else
        error "Control-api server failed to start"
        exit 1
    fi
}

start_frontend() {
    log "Starting frontend dev server..."

    if ! command -v npm >/dev/null 2>&1; then
        error "npm not found. Install with: brew install node"
        exit 1
    fi

    # Install frontend dependencies if needed or if vite binary is missing
    if [[ ! -d "web/node_modules" ]] || [[ ! -f "web/node_modules/.bin/vite" ]]; then
        log "Installing frontend dependencies..."
        (cd web && npm install)
    fi

    kill_port 5173

    # Set API proxy config for Vite
    export VITE_API_HOST="$DEV_HOST_IP"
    export VITE_API_PORT="$SERVER_PORT"
    export VITE_LIVEKIT_HOST="$VITE_LIVEKIT_HOST"
    if [[ "$USE_HTTPS" == "true" ]]; then
        export VITE_API_SECURE="true"
    else
        export VITE_API_SECURE="false"
    fi

    (cd web && npm run dev) &
    PIDS+=($!)

    if wait_for_port 5173 30; then
        if [[ "$USE_HTTPS" == "true" ]]; then
            log "Frontend dev server is ready on https://$DEV_HOST_IP:5173"
        else
            log "Frontend dev server is ready on http://$DEV_HOST_IP:5173"
        fi
    else
        error "Frontend dev server failed to start"
        exit 1
    fi
}

# Parse arguments
RUN_INFRA=false
RUN_SERVER=false
RUN_FRONTEND=false
RUN_ALL=true

while [[ $# -gt 0 ]]; do
    case $1 in
        -a|--all)
            RUN_ALL=true
            shift
            ;;
        -i|--infra)
            RUN_INFRA=true
            RUN_ALL=false
            shift
            ;;
        -s|--server)
            RUN_SERVER=true
            RUN_ALL=false
            shift
            ;;
        -f|--frontend)
            RUN_FRONTEND=true
            RUN_ALL=false
            shift
            ;;
        -h|--help)
            usage
            ;;
        *)
            error "Unknown option: $1"
            usage
            ;;
    esac
done

log "Starting Corvoicer development environment (all services local)..."
echo ""

if [[ "$RUN_ALL" == "true" ]]; then
    start_redis
    start_livekit
    start_ingress
    start_server
    start_frontend
else
    if [[ "$RUN_INFRA" == "true" ]]; then
        start_redis
        start_livekit
        start_ingress
    fi
    [[ "$RUN_SERVER" == "true" ]] && start_server
    [[ "$RUN_FRONTEND" == "true" ]] && start_frontend
fi

log "All services started. Press Ctrl+C to stop."
echo ""
log "Configuration:"
echo "  DEV_HOST_IP:         $DEV_HOST_IP"
echo "  USE_HTTPS:           $USE_HTTPS"
echo "  DATABASE_PATH:       $DATABASE_PATH"
echo "  LIVEKIT_HOST:        $LIVEKIT_HOST"
echo "  SERVER_PORT:         $SERVER_PORT"
echo "  LOG_LEVEL:           $LOG_LEVEL"
echo ""
log "Services:"
[[ "$RUN_ALL" == "true" || "$RUN_INFRA" == "true" ]] && echo "  Redis:            redis://localhost:6379"
# LiveKit and Ingress run without TLS (use reverse proxy for HTTPS/WSS in production)
[[ "$RUN_ALL" == "true" || "$RUN_INFRA" == "true" ]] && echo "  LiveKit:          ws://$DEV_HOST_IP:7880"
[[ "$RUN_ALL" == "true" || "$RUN_INFRA" == "true" ]] && echo "  LiveKit Ingress:  http://$DEV_HOST_IP:7985"
if [[ "$USE_HTTPS" == "true" ]]; then
    [[ "$RUN_ALL" == "true" || "$RUN_SERVER" == "true" ]] && echo "  Control API:      https://$DEV_HOST_IP:$SERVER_PORT"
    [[ "$RUN_ALL" == "true" || "$RUN_FRONTEND" == "true" ]] && echo "  Frontend (Vite):  https://$DEV_HOST_IP:5173"
else
    [[ "$RUN_ALL" == "true" || "$RUN_SERVER" == "true" ]] && echo "  Control API:      http://$DEV_HOST_IP:$SERVER_PORT"
    [[ "$RUN_ALL" == "true" || "$RUN_FRONTEND" == "true" ]] && echo "  Frontend (Vite):  http://$DEV_HOST_IP:5173"
fi
echo ""

# Wait for background processes
wait
