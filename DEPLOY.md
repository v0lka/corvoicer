# Corvoicer: Detailed Production Server Deployment Guide

Step-by-step guide for installing and configuring Corvoicer on a dedicated Linux server with a public IPv4 address.

---

## Table of Contents

1. [Server Requirements](#1-server-requirements)
2. [Server Preparation](#2-server-preparation)
3. [Redis Installation](#3-redis-installation)
4. [LiveKit Server Installation](#4-livekit-server-installation)
5. [LiveKit Ingress Installation](#5-livekit-ingress-installation)
6. [Corvoicer Build and Installation](#6-corvoicer-build-and-installation)
7. [Secrets Generation](#7-secrets-generation)
8. [LiveKit Server Configuration](#8-livekit-server-configuration)
9. [LiveKit Ingress Configuration](#9-livekit-ingress-configuration)
10. [Corvoicer Configuration](#10-corvoicer-configuration)
11. [systemd Services Setup](#11-systemd-services-setup)
12. [Nginx Configuration (Reverse Proxy)](#12-nginx-configuration-reverse-proxy)
13. [SSL Certificate (Let's Encrypt)](#13-ssl-certificate-lets-encrypt)
14. [Firewall Configuration](#14-firewall-configuration)
15. [Starting Services](#15-starting-services)
16. [Health Check](#16-health-check)
17. [Backup Configuration](#17-backup-configuration)
18. [Application Update](#18-application-update)
19. [Troubleshooting](#19-troubleshooting)

---

## 1. Server Requirements

### Minimum Requirements (up to 50 concurrent users)

- **CPU:** 4 cores
- **RAM:** 8 GB
- **Disk:** 50 GB SSD
- **Network:** 100 Mbps
- **OS:** Ubuntu 24.04 LTS (recommended) or Debian 12+

### Recommended Requirements (50-200 users)

- **CPU:** 8 cores
- **RAM:** 16 GB
- **Disk:** 100 GB SSD
- **Network:** 1 Gbps

### Network Requirements

- **Dedicated public IPv4 address** (NAT is not supported for the server)
- **Domain name** (e.g., `voice.example.com`) pointing to the server IP

### Ports to be Used

| Port        | Protocol | Service | Purpose               |
| ----------- | -------- | ------- | --------------------- |
| 22          | TCP      | SSH     | Administration        |
| 80          | TCP      | HTTP    | Redirect to HTTPS     |
| 443         | TCP      | HTTPS   | API + SPA             |
| 7880        | TCP      | LiveKit | HTTP/WebSocket Server |
| 7881        | TCP      | LiveKit | RTC/TCP fallback      |
| 7985        | TCP      | Ingress | WHIP endpoint         |
| 50000-50100 | UDP      | LiveKit | WebRTC media          |
| 60000-60100 | UDP      | Ingress | WHIP media            |

---

## 2. Server Preparation

### 2.1. Connect to Server

```bash
ssh root@YOUR_SERVER_IP
```

### 2.2. Update System

```bash
apt update
apt upgrade -y
```

### 2.3. Install Basic Utilities

```bash
apt install -y curl wget git build-essential unzip sqlite3 lsof net-tools htop
```

### 2.4. Set Timezone

```bash
timedatectl set-timezone Europe/Moscow
```

Replace `Europe/Moscow` with your timezone. List available timezones:

```bash
timedatectl list-timezones
```

### 2.5. Create System Users for Services

```bash
# User for LiveKit
useradd --system --no-create-home --shell /bin/false livekit

# User for Corvoicer
useradd --system --no-create-home --shell /bin/false corvoicer
```

### 2.6. Create Directories

```bash
# Directory for LiveKit configurations
mkdir -p /etc/livekit

# Directory for Corvoicer application
mkdir -p /opt/corvoicer

# Directory for database
mkdir -p /var/lib/corvoicer
chown corvoicer:corvoicer /var/lib/corvoicer

# Directory for backups
mkdir -p /var/backups/corvoicer
```

---

## 3. Redis Installation

### 3.1. Install Package

```bash
apt install -y redis-server
```

### 3.2. Check Version

```bash
redis-server --version
```

Expected output (version may vary):

```
Redis server v=7.0.15 sha=...
```

### 3.3. Configure Redis

Open the configuration file:

```bash
nano /etc/redis/redis.conf
```

Find and modify the following parameters:

```conf
# Bind only to localhost (security)
bind 127.0.0.1 -::1

# Disable persistence (optional, for speed)
# Uncomment if data in Redis is not critical
# save ""
# appendonly no

# Password protection (optional, but recommended)
# requirepass YOUR_REDIS_PASSWORD
```

### 3.4. Restart Redis

```bash
systemctl restart redis-server
```

### 3.5. Enable Autostart

```bash
systemctl enable redis-server
```

### 3.6. Check Operation

```bash
redis-cli ping
```

Expected response:

```
PONG
```

---

## 4. LiveKit Server Installation

### 4.1. Download Binary

Go to the releases page: https://github.com/livekit/livekit/releases

Determine the latest version and architecture:

```bash
uname -m
```

- `x86_64` → download `linux_amd64`
- `aarch64` → download `linux_arm64`

Download and install (replace version with current):

```bash
cd /tmp

# For x86_64 (amd64)
wget https://github.com/livekit/livekit/releases/download/v1.9.2/livekit_1.9.2_linux_amd64.tar.gz

# Extract
tar -xzf livekit_1.9.2_linux_amd64.tar.gz

# Install
mv livekit-server /usr/local/bin/
chmod +x /usr/local/bin/livekit-server
```

### 4.2. Verify Installation

```bash
livekit-server --version
```

Expected output:

```
livekit-server version 1.9.2
```

---

## 5. LiveKit Ingress Installation

Ingress does not have pre-built binaries. Must be built from source.

### 5.1. Install Go

```bash
# Download Go (replace version with current)
cd /tmp
wget https://go.dev/dl/go1.23.4.linux-amd64.tar.gz

# Remove previous version (if exists)
rm -rf /usr/local/go

# Install
tar -C /usr/local -xzf go1.23.4.linux-amd64.tar.gz

# Add to PATH
echo 'export PATH=$PATH:/usr/local/go/bin' >> /etc/profile.d/go.sh
source /etc/profile.d/go.sh

# Verify
go version
```

Expected output:

```
go version go1.23.4 linux/amd64
```

### 5.2. Set GOPATH

```bash
export GOPATH=$HOME/go
export PATH=$PATH:$GOPATH/bin
echo 'export GOPATH=$HOME/go' >> ~/.bashrc
echo 'export PATH=$PATH:$GOPATH/bin' >> ~/.bashrc
```

### 5.3. Install GStreamer and Dependencies

```bash
apt install -y \
    gstreamer1.0-tools \
    gstreamer1.0-plugins-base \
    gstreamer1.0-plugins-good \
    gstreamer1.0-plugins-bad \
    gstreamer1.0-plugins-ugly \
    gstreamer1.0-libav \
    libgstreamer1.0-dev \
    libgstreamer-plugins-base1.0-dev \
    libgstreamer-plugins-bad1.0-dev \
    pkg-config
```

### 5.4. Install mage (Build Tool)

```bash
go install github.com/magefile/mage@latest
```

### 5.5. Clone and Build Ingress

```bash
cd /tmp
git clone https://github.com/livekit/ingress.git
cd ingress

# Build
mage build
```

Build process takes 3-5 minutes.

### 5.6. Install Binary

```bash
cp ingress /usr/local/bin/
chmod +x /usr/local/bin/ingress
```

### 5.7. Verify Installation

```bash
ingress --version
```

Expected output (version may vary):

```
ingress version ...
```

### 5.8. Clean Up Temporary Files

```bash
rm -rf /tmp/ingress
rm -rf /tmp/go*.tar.gz
rm -rf /tmp/livekit*.tar.gz
```

---

## 6. Corvoicer Build and Installation

### 6.1. Install Node.js

```bash
# Install Node.js 22 LTS via NodeSource
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs

# Check versions
node --version
npm --version
```

### 6.2. Clone Repository

```bash
cd /opt
git clone https://github.com/YOUR_ORG/corvoicer.git
cd corvoicer
```

Replace `YOUR_ORG/corvoicer` with your actual repository URL.

### 6.3. Build Frontend

```bash
cd /opt/corvoicer/web

# Install dependencies
npm install

# Build production version
npm run build
```

### 6.4. Copy Frontend to Server Directory

```bash
# Create directory (if not exists) and clean old files
mkdir -p /opt/corvoicer/server/cmd/server/dist
rm -rf /opt/corvoicer/server/cmd/server/dist/*

# Copy built frontend
cp -r /opt/corvoicer/web/dist/* /opt/corvoicer/server/cmd/server/dist/
```

### 6.5. Build Backend Server

```bash
cd /opt/corvoicer/server

# Build
go build -o /opt/corvoicer/server-bin ./cmd/server/

# Set permissions
chmod +x /opt/corvoicer/server-bin
```

### 6.6. Verify Binary

```bash
ls -la /opt/corvoicer/server-bin
```

Should display an executable file several megabytes in size.

---

## 7. Secrets Generation

**IMPORTANT:** Never use development keys in production!

### 7.1. Generate LIVEKIT_API_SECRET

```bash
openssl rand -base64 32
```

Example output:

```
kF2x9vBzN3mQ8pR5tY7wE1aD4gJ6hL0S9uI2oP5qW8e=
```

**Record this value as `LIVEKIT_API_SECRET`**

### 7.2. Generate INVITE_TOKEN_SECRET

```bash
openssl rand -base64 32
```

Example output:

```
mN7bV2cX8zQ1wE4rT6yU9iO3pA5sD0fG7hJ2kL4nM8b=
```

**Record this value as `INVITE_TOKEN_SECRET`**

### 7.3. Generate ADMIN_TOKEN

```bash
openssl rand -base64 24
```

Example output:

```
xK9mN2vB5cX8zQ1wE4rT6yU9iO3p
```

**Record this value as `ADMIN_TOKEN`**

### 7.4. Choose LIVEKIT_API_KEY

Choose a clear name for the API key (no spaces or special characters):

```
corvoicer_prod
```

**Record this value as `LIVEKIT_API_KEY`**

### 7.5. Secrets Summary

Create a secure file for storing secrets:

```bash
nano /root/corvoicer-secrets.txt
```

Content:

```
LIVEKIT_API_KEY=corvoicer_prod
LIVEKIT_API_SECRET=kF2x9vBzN3mQ8pR5tY7wE1aD4gJ6hL0S9uI2oP5qW8e=
INVITE_TOKEN_SECRET=mN7bV2cX8zQ1wE4rT6yU9iO3pA5sD0fG7hJ2kL4nM8b=
ADMIN_TOKEN=xK9mN2vB5cX8zQ1wE4rT6yU9iO3p
```

Protect the file:

```bash
chmod 600 /root/corvoicer-secrets.txt
```

---

## 8. LiveKit Server Configuration

### 8.1. Create Configuration File

```bash
nano /etc/livekit/config.yaml
```

### 8.2. File Content

Paste the following, replacing `<LIVEKIT_API_KEY>` and `<LIVEKIT_API_SECRET>` with your values:

```yaml
# /etc/livekit/config.yaml

# HTTP port for API and WebSocket
port: 7880

# RTC (WebRTC) settings
rtc:
  # UDP port range for media streams
  port_range_start: 50000
  port_range_end: 50100

  # TCP port for fallback (when UDP is blocked)
  tcp_port: 7881

  # IMPORTANT: use_external_ip allows the server to automatically
  # detect and advertise its public IP
  use_external_ip: true

  # STUN servers for NAT traversal
  # Allow clients behind NAT to connect to the server
  stun_servers:
    - stun.l.google.com:19302
    - stun1.l.google.com:19302

# Redis for session state storage
redis:
  address: localhost:6379
  # Uncomment if Redis is password protected:
  # password: YOUR_REDIS_PASSWORD

# Ingress URLs (for OBS streaming)
ingress:
  rtmp_base_url: "rtmp://YOUR_DOMAIN:1935/live"
  whip_base_url: "https://YOUR_DOMAIN/whip"

# API keys
# Format: key: "secret"
keys:
  <LIVEKIT_API_KEY>: "<LIVEKIT_API_SECRET>"

# Logging
logging:
  level: info
  # json: true  # Uncomment for JSON log format

# Room settings
room:
  # Maximum number of participants in a room
  max_participants: 16

  # Empty room lifetime (seconds)
  empty_timeout: 300
```

### 8.3. Example with Real Values

If your secrets are:

- `LIVEKIT_API_KEY=corvoicer_prod`
- `LIVEKIT_API_SECRET=kF2x9vBzN3mQ8pR5tY7wE1aD4gJ6hL0S9uI2oP5qW8e=`
- Domain: `voice.example.com`

Then the `keys` section will be:

```yaml
keys:
  corvoicer_prod: "kF2x9vBzN3mQ8pR5tY7wE1aD4gJ6hL0S9uI2oP5qW8e="
```

And the `ingress` section:

```yaml
ingress:
  rtmp_base_url: "rtmp://voice.example.com:1935/live"
  whip_base_url: "https://voice.example.com/whip"
```

### 8.4. Set Permissions

```bash
chmod 640 /etc/livekit/config.yaml
chown root:livekit /etc/livekit/config.yaml
```

---

## 9. LiveKit Ingress Configuration

### 9.1. Create Configuration File

```bash
nano /etc/livekit/ingress.yaml
```

### 9.2. File Content

**IMPORTANT:** Ingress uses the key `rtc_config`, NOT `rtc` as in LiveKit Server!

```yaml
# /etc/livekit/ingress.yaml

# Authentication (same keys as LiveKit Server)
api_key: <LIVEKIT_API_KEY>
api_secret: "<LIVEKIT_API_SECRET>"

# URL for connecting to LiveKit Server
# Using ws:// because Ingress and LiveKit are on the same server
ws_url: ws://localhost:7880

# RTC settings for Ingress
# IMPORTANT: rtc_config, NOT rtc!
rtc_config:
  # UDP port range (does not overlap with LiveKit)
  port_range_start: 60000
  port_range_end: 60100

  # Auto-detect public IP
  use_external_ip: true

  # STUN servers for NAT traversal for OBS streamers
  stun_servers:
    - stun.l.google.com:19302
    - stun1.l.google.com:19302

# Redis
redis:
  address: localhost:6379
  # password: YOUR_REDIS_PASSWORD

# Logging
logging:
  level: info

# WHIP endpoint port
whip_port: 7985

# Bind WHIP to all interfaces
whip_bind_addr: 0.0.0.0

# Disable transcoding (CPU savings)
enable_transcoding: false
```

### 9.3. Example with Real Values

If your secrets are:

- `LIVEKIT_API_KEY=corvoicer_prod`
- `LIVEKIT_API_SECRET=kF2x9vBzN3mQ8pR5tY7wE1aD4gJ6hL0S9uI2oP5qW8e=`

```yaml
api_key: corvoicer_prod
api_secret: "kF2x9vBzN3mQ8pR5tY7wE1aD4gJ6hL0S9uI2oP5qW8e="
```

### 9.4. Set Permissions

```bash
chmod 640 /etc/livekit/ingress.yaml
chown root:livekit /etc/livekit/ingress.yaml
```

---

## 10. Corvoicer Configuration

Corvoicer is configured via environment variables. Values are set in the systemd service (section 11.3).

### 10.1. Environment Variables Reference

| Variable              | Recommended Value                 | Description                           |
| --------------------- | --------------------------------- | ------------------------------------- |
| `SERVER_PORT`         | `8080`                            | HTTP server port                      |
| `BIND_ADDR`           | `127.0.0.1`                       | Bind address                          |
| `DATABASE_PATH`       | `/var/lib/corvoicer/corvoicer.db` | Path to SQLite DB                     |
| `LIVEKIT_HOST`        | `wss://YOUR_DOMAIN/livekit`       | LiveKit Server URL (via Nginx)        |
| `LIVEKIT_API_KEY`     | Your key from section 7           | LiveKit API key                       |
| `LIVEKIT_API_SECRET`  | Your secret from section 7        | LiveKit API secret                    |
| `WHIP_BASE_URL`       | `https://YOUR_DOMAIN/whip`        | URL for OBS WHIP (displayed in UI)    |
| `INVITE_TOKEN_SECRET` | Your secret from section 7        | JWT secret for invites (min 32 chars) |
| `ADMIN_TOKEN`         | Your token from section 7         | Administrator token (min 8 chars)     |
| `ROOM_DEFAULT_TTL`    | `24h`                             | Room lifetime                         |
| `LOG_LEVEL`           | `info`                            | Log level                             |

---

## 11. systemd Services Setup

### 11.1. LiveKit Server Service

```bash
nano /etc/systemd/system/livekit.service
```

Content:

```ini
[Unit]
Description=LiveKit Server
Documentation=https://docs.livekit.io
After=network.target redis-server.service
Requires=redis-server.service

[Service]
Type=simple
User=livekit
Group=livekit
ExecStart=/usr/local/bin/livekit-server --config /etc/livekit/config.yaml
Restart=always
RestartSec=5

# Security hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=livekit

[Install]
WantedBy=multi-user.target
```

### 11.2. LiveKit Ingress Service

```bash
nano /etc/systemd/system/livekit-ingress.service
```

Content:

```ini
[Unit]
Description=LiveKit Ingress
Documentation=https://github.com/livekit/ingress
After=network.target livekit.service
Requires=livekit.service

[Service]
Type=simple
User=livekit
Group=livekit
Environment="INGRESS_CONFIG_FILE=/etc/livekit/ingress.yaml"
ExecStart=/usr/local/bin/ingress
Restart=always
RestartSec=5

# Security hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=livekit-ingress

[Install]
WantedBy=multi-user.target
```

### 11.3. Corvoicer Service

```bash
nano /etc/systemd/system/corvoicer.service
```

Content (replace `<...>` with your values):

```ini
[Unit]
Description=Corvoicer Control API
Documentation=https://github.com/YOUR_ORG/corvoicer
After=network.target livekit.service livekit-ingress.service
Requires=livekit.service

[Service]
Type=simple
User=corvoicer
Group=corvoicer
WorkingDirectory=/opt/corvoicer

# Environment variables
Environment="SERVER_PORT=8080"
Environment="BIND_ADDR=127.0.0.1"
Environment="DATABASE_PATH=/var/lib/corvoicer/corvoicer.db"
Environment="LIVEKIT_HOST=wss://<YOUR_DOMAIN>/livekit"
Environment="LIVEKIT_API_KEY=<LIVEKIT_API_KEY>"
Environment="LIVEKIT_API_SECRET=<LIVEKIT_API_SECRET>"
Environment="WHIP_BASE_URL=https://<YOUR_DOMAIN>/whip"
Environment="INVITE_TOKEN_SECRET=<INVITE_TOKEN_SECRET>"
Environment="ADMIN_TOKEN=<ADMIN_TOKEN>"
Environment="ROOM_DEFAULT_TTL=24h"
Environment="LOG_LEVEL=info"

ExecStart=/opt/corvoicer/server-bin
Restart=always
RestartSec=5

# Security hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=/var/lib/corvoicer

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=corvoicer

[Install]
WantedBy=multi-user.target
```

### 11.4. Example with Real Values

Environment section with your secrets (for domain `voice.example.com`):

```ini
Environment="LIVEKIT_HOST=wss://voice.example.com/livekit"
Environment="LIVEKIT_API_KEY=corvoicer_prod"
Environment="LIVEKIT_API_SECRET=kF2x9vBzN3mQ8pR5tY7wE1aD4gJ6hL0S9uI2oP5qW8e="
Environment="WHIP_BASE_URL=https://voice.example.com/whip"
Environment="INVITE_TOKEN_SECRET=mN7bV2cX8zQ1wE4rT6yU9iO3pA5sD0fG7hJ2kL4nM8b="
Environment="ADMIN_TOKEN=xK9mN2vB5cX8zQ1wE4rT6yU9iO3p"
```

### 11.5. Reload systemd Configuration

```bash
systemctl daemon-reload
```

---

## 12. Nginx Configuration (Reverse Proxy)

### 12.1. Install Nginx

```bash
apt install -y nginx
```

### 12.2. Check Version

```bash
nginx -v
```

### 12.3. Create Site Configuration

```bash
nano /etc/nginx/sites-available/corvoicer
```

Content (replace `YOUR_DOMAIN` with your domain):

```nginx
# Upstream for API server
upstream corvoicer_api {
    server 127.0.0.1:8080;
    keepalive 32;
}

# Redirect HTTP → HTTPS
server {
    listen 80;
    listen [::]:80;
    server_name YOUR_DOMAIN;

    # For Let's Encrypt challenge
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    # Redirect everything else to HTTPS
    location / {
        return 301 https://$server_name$request_uri;
    }
}

# HTTPS server
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name YOUR_DOMAIN;

    # SSL certificates (will be created by certbot)
    ssl_certificate /etc/letsencrypt/live/YOUR_DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/YOUR_DOMAIN/privkey.pem;

    # SSL settings
    ssl_session_timeout 1d;
    ssl_session_cache shared:SSL:50m;
    ssl_session_tickets off;

    # Modern protocols and ciphers
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;

    # HSTS (Strict Transport Security)
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    # Other security headers
    add_header X-Frame-Options SAMEORIGIN always;
    add_header X-Content-Type-Options nosniff always;
    add_header X-XSS-Protection "1; mode=block" always;

    # Gzip compression
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml;
    gzip_min_length 1000;

    # Main location - proxy to API
    location / {
        proxy_pass http://corvoicer_api;
        proxy_http_version 1.1;

        # Headers
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;

        # Buffering
        proxy_buffering on;
        proxy_buffer_size 4k;
        proxy_buffers 8 4k;
    }

    # Health check endpoint (no logs)
    location /health {
        proxy_pass http://corvoicer_api/health;
        access_log off;
    }

    # Static files (caching)
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2)$ {
        proxy_pass http://corvoicer_api;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    # LiveKit WebSocket proxy
    location /livekit {
        proxy_pass http://127.0.0.1:7880/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
    }

    # WHIP endpoint for OBS streaming
    location /whip {
        proxy_pass http://127.0.0.1:7985/w;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
    }
}
```

### 12.4. Save Configuration

```bash
# Remove default site
rm -f /etc/nginx/sites-enabled/default
```

Configuration references SSL certificates that will be created in section 13.

### 12.5. Create Directory for Certbot

```bash
mkdir -p /var/www/certbot
```

---

## 13. SSL Certificate (Let's Encrypt)

### 13.1. Install Certbot

```bash
apt install -y certbot python3-certbot-nginx
```

### 13.2. Temporary Nginx Configuration (Before Getting Certificate)

Create a temporary configuration for HTTP only:

```bash
nano /etc/nginx/sites-available/corvoicer-temp
```

Content:

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name YOUR_DOMAIN;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 200 'Waiting for SSL certificate';
        add_header Content-Type text/plain;
    }
}
```

### 13.3. Activate Temporary Configuration

```bash
rm /etc/nginx/sites-enabled/corvoicer
ln -s /etc/nginx/sites-available/corvoicer-temp /etc/nginx/sites-enabled/
nginx -t
systemctl restart nginx
```

### 13.4. Get Certificate

```bash
certbot certonly --webroot -w /var/www/certbot -d YOUR_DOMAIN --email YOUR_EMAIL --agree-tos --no-eff-email
```

Replace:

- `YOUR_DOMAIN` — your domain (e.g., `voice.example.com`)
- `YOUR_EMAIL` — email for renewal notifications

### 13.5. Verify Certificate Creation

```bash
ls -la /etc/letsencrypt/live/YOUR_DOMAIN/
```

Files should be present:

- `fullchain.pem`
- `privkey.pem`
- `cert.pem`
- `chain.pem`

### 13.6. Activate Main Configuration

```bash
rm /etc/nginx/sites-enabled/corvoicer-temp
ln -s /etc/nginx/sites-available/corvoicer /etc/nginx/sites-enabled/
nginx -t
```

Expected output:

```
nginx: the configuration file /etc/nginx/nginx.conf syntax is ok
nginx: configuration file /etc/nginx/nginx.conf test is successful
```

Restart Nginx:

```bash
systemctl restart nginx
```

### 13.7. Configure Auto-Renewal

Certbot automatically configures cron/systemd timer. Check:

```bash
systemctl list-timers | grep certbot
```

Or check cron:

```bash
cat /etc/cron.d/certbot
```

### 13.8. Test Auto-Renewal

```bash
certbot renew --dry-run
```

---

## 14. Firewall Configuration

### 14.1. Check UFW Status

```bash
ufw status
```

### 14.2. Configure Rules

```bash
# SSH (IMPORTANT: allow SSH first!)
# Recommended to restrict to your IP:
ufw allow from YOUR_ADMIN_IP to any port 22

# Or allow from anywhere (less secure):
# ufw allow 22/tcp

# HTTP (for redirect and Let's Encrypt)
ufw allow 80/tcp

# HTTPS (main traffic)
ufw allow 443/tcp

# LiveKit HTTP/WebSocket
ufw allow 7880/tcp

# LiveKit RTC/TCP fallback
ufw allow 7881/tcp

# Ingress WHIP
ufw allow 7985/tcp

# LiveKit WebRTC UDP
ufw allow 50000:50100/udp

# Ingress WebRTC UDP
ufw allow 60000:60100/udp
```

### 14.3. Enable Firewall

**WARNING:** Make sure SSH is allowed before enabling!

```bash
ufw enable
```

Confirm: `y`

### 14.4. Verify Rules

```bash
ufw status verbose
```

Expected output:

```
Status: active

To                         Action      From
--                         ------      ----
22/tcp                     ALLOW       YOUR_ADMIN_IP
80/tcp                     ALLOW       Anywhere
443/tcp                    ALLOW       Anywhere
7880/tcp                   ALLOW       Anywhere
7881/tcp                   ALLOW       Anywhere
7985/tcp                   ALLOW       Anywhere
50000:50100/udp            ALLOW       Anywhere
60000:60100/udp            ALLOW       Anywhere
...
```

---

## 15. Starting Services

### 15.1. Start in Correct Order

```bash
# 1. Redis (should already be running)
systemctl status redis-server

# 2. LiveKit Server
systemctl start livekit
systemctl status livekit

# 3. LiveKit Ingress
systemctl start livekit-ingress
systemctl status livekit-ingress

# 4. Corvoicer
systemctl start corvoicer
systemctl status corvoicer

# 5. Nginx (should already be running)
systemctl status nginx
```

### 15.2. Enable Autostart

```bash
systemctl enable redis-server
systemctl enable livekit
systemctl enable livekit-ingress
systemctl enable corvoicer
systemctl enable nginx
```

### 15.3. Check Status of All Services

```bash
systemctl status redis-server livekit livekit-ingress corvoicer nginx
```

---

## 16. Health Check

### 16.1. Check Ports

```bash
# Check listening ports
ss -tlnp | grep -E '(6379|7880|7881|7985|8080|80|443)'
```

Expected output should show all services.

### 16.2. Check Health Endpoint

```bash
# Locally
curl http://localhost:8080/health

# Via Nginx (HTTPS)
curl https://YOUR_DOMAIN/health
```

Expected response:

```json
{ "status": "ok" }
```

### 16.3. Check Logs

```bash
# LiveKit
journalctl -u livekit -f

# Ingress
journalctl -u livekit-ingress -f

# Corvoicer
journalctl -u corvoicer -f
```

### 16.4. Check WebRTC Connection

Open in browser: `https://YOUR_DOMAIN`

Try to create a room and connect. In case of problems check:

- Browser console (F12 → Console)
- LiveKit logs
- Corvoicer logs

### 16.5. Check WHIP (for OBS)

In OBS:

1. Settings → Stream
2. Service: WHIP
3. Server: `https://YOUR_DOMAIN/whip`
4. Bearer Token: (get via API)

---

## 17. Backup Configuration

### 17.1. Create Backup Script

```bash
nano /usr/local/bin/backup-corvoicer.sh
```

Content:

```bash
#!/bin/bash
# Corvoicer backup script

set -euo pipefail

BACKUP_DIR=/var/backups/corvoicer
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
DB_PATH=/var/lib/corvoicer/corvoicer.db

# Create directory if not exists
mkdir -p "$BACKUP_DIR"

# Create database backup
sqlite3 "$DB_PATH" ".backup '$BACKUP_DIR/corvoicer_$TIMESTAMP.db'"

# Compress
gzip "$BACKUP_DIR/corvoicer_$TIMESTAMP.db"

# Delete backups older than 7 days
find "$BACKUP_DIR" -name "corvoicer_*.db.gz" -mtime +7 -delete

echo "Backup completed: $BACKUP_DIR/corvoicer_$TIMESTAMP.db.gz"
```

### 17.2. Set Permissions

```bash
chmod +x /usr/local/bin/backup-corvoicer.sh
```

### 17.3. Test Run

```bash
/usr/local/bin/backup-corvoicer.sh
```

### 17.4. Configure Cron

```bash
crontab -e
```

Add line (backup every day at 2:00):

```
0 2 * * * /usr/local/bin/backup-corvoicer.sh >> /var/log/corvoicer-backup.log 2>&1
```

### 17.5. Check Cron

```bash
crontab -l
```

---

## 18. Application Update

### 18.1. Get Updates

```bash
cd /opt/corvoicer
git pull origin main
```

### 18.2. Rebuild Frontend

```bash
cd /opt/corvoicer/web
npm install
npm run build
```

### 18.3. Copy Frontend

```bash
rm -rf /opt/corvoicer/server/cmd/server/dist/*
cp -r /opt/corvoicer/web/dist/* /opt/corvoicer/server/cmd/server/dist/
```

### 18.4. Rebuild Backend

```bash
cd /opt/corvoicer/server
go build -o /opt/corvoicer/server-bin ./cmd/server/
```

### 18.5. Restart Service

```bash
systemctl restart corvoicer
```

### 18.6. Verify

```bash
systemctl status corvoicer
journalctl -u corvoicer -n 50
curl https://YOUR_DOMAIN/health
```

---

## 19. Troubleshooting

### 19.1. Service Won't Start

```bash
# Check status
systemctl status SERVICE_NAME

# Detailed logs
journalctl -u SERVICE_NAME -n 100 --no-pager

# Check configuration
# For LiveKit:
livekit-server --config /etc/livekit/config.yaml --dev

# For Ingress:
INGRESS_CONFIG_FILE=/etc/livekit/ingress.yaml ingress
```

### 19.2. WebRTC Won't Connect

```bash
# Check UDP ports
nc -vzu YOUR_SERVER_IP 50000

# Check firewall
ufw status verbose

# LiveKit logs
journalctl -u livekit -f
```

### 19.3. Database Locked

```bash
# Check processes
lsof /var/lib/corvoicer/corvoicer.db

# Restart service
systemctl restart corvoicer
```

### 19.4. Enable Debug Logs

```bash
# Edit service
systemctl edit corvoicer
```

Add:

```ini
[Service]
Environment="LOG_LEVEL=debug"
```

Restart:

```bash
systemctl daemon-reload
systemctl restart corvoicer
journalctl -u corvoicer -f
```

### 19.5. Check SSL Certificate

```bash
# Certificate information
openssl s_client -connect YOUR_DOMAIN:443 -servername YOUR_DOMAIN < /dev/null 2>/dev/null | openssl x509 -noout -dates

# Check certbot certificate
certbot certificates
```

### 19.6. Restart All Services

```bash
systemctl restart redis-server livekit livekit-ingress corvoicer nginx
```

---

## Checklist

After completing all steps, verify:

- [ ] All services running: `systemctl status redis-server livekit livekit-ingress corvoicer nginx`
- [ ] Health endpoint responds: `curl https://YOUR_DOMAIN/health`
- [ ] HTTPS works: browser shows no certificate warnings
- [ ] Autostart enabled: `systemctl is-enabled redis-server livekit livekit-ingress corvoicer nginx`
- [ ] Firewall active: `ufw status`
- [ ] Backups configured: `crontab -l`
- [ ] Secrets securely saved

---

## Useful Commands

```bash
# View all logs in real-time
journalctl -f

# Resource usage
htop

# Disk space
df -h

# Network connections
ss -tunap

# Open files by process
lsof -p $(pgrep corvoicer)
```
