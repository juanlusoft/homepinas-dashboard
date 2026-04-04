#!/usr/bin/env bash
# HomePiNAS Dashboard — Install / Setup Script
# Tested on Raspberry Pi OS (Debian Bookworm), Ubuntu 22.04+
# Run as root: sudo bash install.sh
# Or as a normal user with sudo rights: bash install.sh
#
# What this script does:
#   1. Checks system requirements (Node.js >= 20, npm, openssl, build-essential)
#   2. Installs missing system packages
#   3. Runs npm install (compiles native modules: better-sqlite3, node-pty)
#   4. Creates required directories
#   5. Generates .env with TOTP_SERVER_KEY and sane defaults (skips if exists)
#   6. Generates self-signed SSL certificates (skips if certs already present)
#   7. Installs a systemd service (optional, asks)
#   8. Runs typecheck + tests as a smoke check

set -euo pipefail

# ---------------------------------------------------------------------------
# Colours
# ---------------------------------------------------------------------------
RED='\033[0;31m'
GRN='\033[0;32m'
YLW='\033[1;33m'
BLU='\033[1;34m'
CYN='\033[0;36m'
RST='\033[0m'

step()  { echo -e "\n${BLU}▶ $*${RST}"; }
ok()    { echo -e "  ${GRN}✓${RST} $*"; }
warn()  { echo -e "  ${YLW}⚠${RST}  $*"; }
error() { echo -e "  ${RED}✗${RST} $*" >&2; }
die()   { error "$*"; exit 1; }

# ---------------------------------------------------------------------------
# Resolve script location (project root)
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
PROJECT_ROOT="$SCRIPT_DIR"

echo -e "${CYN}"
echo "  ██╗  ██╗ ██████╗ ███╗   ███╗███████╗██████╗ ██╗███╗   ██╗ █████╗ ███████╗"
echo "  ██║  ██║██╔═══██╗████╗ ████║██╔════╝██╔══██╗██║████╗  ██║██╔══██╗██╔════╝"
echo "  ███████║██║   ██║██╔████╔██║█████╗  ██████╔╝██║██╔██╗ ██║███████║███████╗"
echo "  ██╔══██║██║   ██║██║╚██╔╝██║██╔══╝  ██╔═══╝ ██║██║╚██╗██║██╔══██║╚════██║"
echo "  ██║  ██║╚██████╔╝██║ ╚═╝ ██║███████╗██║     ██║██║ ╚████║██║  ██║███████║"
echo "  ╚═╝  ╚═╝ ╚═════╝ ╚═╝     ╚═╝╚══════╝╚═╝     ╚═╝╚═╝  ╚═══╝╚═╝  ╚═╝╚══════╝"
echo -e "${RST}"
echo -e "  ${CYN}HomePiNAS Dashboard — Installer${RST}"
echo -e "  Project root: ${PROJECT_ROOT}\n"

# ---------------------------------------------------------------------------
# 1. Root / sudo check
# ---------------------------------------------------------------------------
step "Checking permissions"
SUDO=""
if [[ $EUID -ne 0 ]]; then
    if command -v sudo &>/dev/null; then
        SUDO="sudo"
        warn "Not running as root — will use sudo for system package installation"
    else
        warn "Not root and sudo not found — system package installation may fail"
    fi
else
    ok "Running as root"
fi

# ---------------------------------------------------------------------------
# 2. System requirements
# ---------------------------------------------------------------------------
step "Checking system requirements"

# Node.js >= 20
if ! command -v node &>/dev/null; then
    die "Node.js not found. Install Node.js 20+ from https://nodejs.org or via nvm"
fi
NODE_VER=$(node -e "process.stdout.write(process.version.slice(1).split('.')[0])")
if [[ "$NODE_VER" -lt 20 ]]; then
    die "Node.js ${NODE_VER} found, but >= 20 is required"
fi
ok "Node.js v$(node --version | tr -d v) (>= 20 ✓)"

# npm
if ! command -v npm &>/dev/null; then
    die "npm not found"
fi
ok "npm $(npm --version)"

# openssl
if ! command -v openssl &>/dev/null; then
    warn "openssl not found — SSL certificate generation will be skipped"
    HAS_OPENSSL=0
else
    ok "openssl $(openssl version | awk '{print $2}')"
    HAS_OPENSSL=1
fi

# ---------------------------------------------------------------------------
# 3. System packages (build-essential for native modules)
# ---------------------------------------------------------------------------
step "Installing system packages"

if command -v apt-get &>/dev/null; then
    MISSING_PKGS=()
    for pkg in build-essential python3 openssl; do
        if ! dpkg -s "$pkg" &>/dev/null 2>&1; then
            MISSING_PKGS+=("$pkg")
        fi
    done

    if [[ ${#MISSING_PKGS[@]} -gt 0 ]]; then
        echo "  Installing: ${MISSING_PKGS[*]}"
        $SUDO apt-get update -qq
        $SUDO apt-get install -y -qq "${MISSING_PKGS[@]}"
        ok "System packages installed"
        HAS_OPENSSL=1
    else
        ok "All required packages already installed"
    fi
else
    warn "apt-get not found — skipping system package check (non-Debian system)"
    warn "Ensure build-essential equivalent is installed for native module compilation"
fi

# ---------------------------------------------------------------------------
# 4. npm install (compiles better-sqlite3 and node-pty)
# ---------------------------------------------------------------------------
step "Installing Node.js dependencies"

if [[ -d node_modules && -f node_modules/.package-lock.json ]]; then
    ok "node_modules already present — running npm ci for reproducible install"
    npm ci --prefer-offline 2>&1 | grep -v "^npm warn" || true
else
    echo "  Compiling native modules (better-sqlite3, node-pty) — this may take a few minutes..."
    npm install 2>&1 | grep -E "^(added|removed|changed|npm error)" || true
fi
ok "Dependencies installed"

# ---------------------------------------------------------------------------
# 5. Required directories
# ---------------------------------------------------------------------------
step "Creating required directories"

DIRS=(
    "${PROJECT_ROOT}/config"
    "${PROJECT_ROOT}/backend/certs"
)

# Storage directories (only if /mnt/storage exists — i.e. running on the NAS)
if [[ -d /mnt/storage ]]; then
    DIRS+=("/mnt/storage/.tmp" "/mnt/storage/.uploads-tmp")
fi

for dir in "${DIRS[@]}"; do
    if [[ ! -d "$dir" ]]; then
        mkdir -p "$dir"
        ok "Created $dir"
    else
        ok "$dir already exists"
    fi
done

# ---------------------------------------------------------------------------
# 6. Environment file
# ---------------------------------------------------------------------------
step "Setting up environment variables"

ENV_FILE="${PROJECT_ROOT}/.env"

if [[ -f "$ENV_FILE" ]]; then
    ok ".env already exists — skipping (delete it to regenerate)"
else
    echo "  Generating TOTP_SERVER_KEY..."
    TOTP_KEY=$(openssl rand -hex 32 2>/dev/null || node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))")

    cat > "$ENV_FILE" <<EOF
# HomePiNAS Dashboard — Environment Configuration
# Generated by install.sh on $(date -u +"%Y-%m-%dT%H:%M:%SZ")
# DO NOT COMMIT THIS FILE

# Server ports
HTTPS_PORT=443
HTTP_PORT=80

# Session settings (milliseconds)
SESSION_DURATION=86400000        # 24 hours
SESSION_IDLE_TIMEOUT=3600000     # 1 hour

# Health monitor thresholds
TEMP_THRESHOLD_C=75              # Disk temperature alert (°C)
POOL_USAGE_THRESHOLD=85          # Storage pool usage alert (%)

# TOTP secret encryption key (AES-256-GCM)
# KEEP SECRET — rotating this key invalidates all existing 2FA registrations
TOTP_SERVER_KEY=${TOTP_KEY}

# Logging
LOG_LEVEL=info
NODE_ENV=production
EOF

    chmod 600 "$ENV_FILE"
    ok ".env created at ${ENV_FILE}"
    warn "TOTP_SERVER_KEY generated — back it up securely, losing it invalidates all 2FA"
fi

# ---------------------------------------------------------------------------
# 7. SSL Certificates
# ---------------------------------------------------------------------------
step "Setting up SSL certificates"

CERT_PATH="${PROJECT_ROOT}/backend/certs/server.crt"
KEY_PATH="${PROJECT_ROOT}/backend/certs/server.key"

if [[ -f "$CERT_PATH" && -f "$KEY_PATH" ]]; then
    ok "SSL certificates already present — skipping"
    CERT_EXPIRY=$(openssl x509 -enddate -noout -in "$CERT_PATH" 2>/dev/null | cut -d= -f2 || echo "unknown")
    ok "Certificate expires: ${CERT_EXPIRY}"
elif [[ "$HAS_OPENSSL" -eq 1 ]]; then
    echo "  Generating self-signed certificate..."
    HOSTNAME=$(hostname)
    LOCAL_IP=$(ip route get 1.1.1.1 2>/dev/null | grep -oP 'src \K[^ ]+' || echo "127.0.0.1")

    SSL_CNF_DIR="${PROJECT_ROOT}/backend/certs"
    SSL_CNF="${SSL_CNF_DIR}/openssl.cnf"

    cat > "$SSL_CNF" <<EOF
[req]
distinguished_name = req_distinguished_name
x509_extensions = v3_req
prompt = no

[req_distinguished_name]
C = ES
ST = Local
L = HomeLab
O = HomePiNAS
OU = NAS
CN = ${HOSTNAME}

[v3_req]
keyUsage = critical, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names

[alt_names]
DNS.1 = ${HOSTNAME}
DNS.2 = homepinas.local
DNS.3 = localhost
IP.1 = ${LOCAL_IP}
IP.2 = 127.0.0.1
EOF

    openssl req -x509 -nodes -days 3650 \
        -newkey rsa:2048 \
        -keyout "$KEY_PATH" \
        -out "$CERT_PATH" \
        -config "$SSL_CNF" \
        2>/dev/null

    chmod 600 "$KEY_PATH"
    rm -f "$SSL_CNF"
    ok "Self-signed certificate generated (valid 10 years)"
    ok "  Hostname: ${HOSTNAME}"
    ok "  IP: ${LOCAL_IP}"
    warn "Browser will show a security warning — this is expected for self-signed certs"
    warn "To avoid it: install the cert in your browser/OS trust store, or use Let's Encrypt"
else
    warn "openssl not found — SSL cert generation skipped"
    warn "The server will auto-generate a cert on first start if openssl is available then"
fi

# ---------------------------------------------------------------------------
# 8. TypeScript type check
# ---------------------------------------------------------------------------
step "Running TypeScript type check"

if npm run typecheck 2>&1 | tail -3 | grep -q "error TS"; then
    error "TypeScript errors found — install may be incomplete"
    npm run typecheck 2>&1 | grep "error TS" | head -10
    warn "Continuing anyway — check errors before starting the server"
else
    ok "TypeScript: 0 errors"
fi

# ---------------------------------------------------------------------------
# 9. Tests
# ---------------------------------------------------------------------------
step "Running tests"

TEST_OUTPUT=$(npm test 2>&1 | tail -5)
if echo "$TEST_OUTPUT" | grep -q "failed"; then
    FAILED=$(echo "$TEST_OUTPUT" | grep -oP '\d+ failed')
    warn "Tests: ${FAILED} — check output above"
    npm test 2>&1 | grep "×" | head -10 || true
else
    PASSED=$(echo "$TEST_OUTPUT" | grep -oP '\d+ passed' | head -1)
    ok "Tests: ${PASSED:-all passing}"
fi

# ---------------------------------------------------------------------------
# 10. Systemd service (optional)
# ---------------------------------------------------------------------------
step "Systemd service setup"

SERVICE_FILE="/etc/systemd/system/homepinas.service"
INSTALL_USER="${SUDO_USER:-$(whoami)}"
NODE_BIN=$(command -v node)
NPM_BIN=$(command -v npm)

if [[ ! -f "$SERVICE_FILE" ]]; then
    echo ""
    read -rp "  Install systemd service (auto-start on boot)? [y/N] " INSTALL_SERVICE
    INSTALL_SERVICE="${INSTALL_SERVICE:-n}"
else
    ok "Systemd service already installed at ${SERVICE_FILE}"
    INSTALL_SERVICE="n"
fi

if [[ "$INSTALL_SERVICE" =~ ^[Yy]$ ]]; then
    if [[ $EUID -ne 0 && -z "$SUDO" ]]; then
        warn "Cannot install systemd service without root/sudo — skipping"
    else
        cat > /tmp/homepinas.service <<EOF
[Unit]
Description=HomePiNAS Dashboard
Documentation=https://github.com/juanlusoft/homepinas-dashboard
After=network.target
Wants=network-online.target

[Service]
Type=simple
User=${INSTALL_USER}
WorkingDirectory=${PROJECT_ROOT}
EnvironmentFile=${ENV_FILE}
ExecStart=${NPM_BIN} start
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=homepinas

# Hardening
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=full
ProtectHome=read-only
ReadWritePaths=${PROJECT_ROOT}/config ${PROJECT_ROOT}/backend/certs /mnt/storage

[Install]
WantedBy=multi-user.target
EOF

        $SUDO mv /tmp/homepinas.service "$SERVICE_FILE"
        $SUDO systemctl daemon-reload
        $SUDO systemctl enable homepinas
        ok "Service installed and enabled"
        ok "  Start:   sudo systemctl start homepinas"
        ok "  Stop:    sudo systemctl stop homepinas"
        ok "  Logs:    sudo journalctl -u homepinas -f"
    fi
else
    ok "Skipped systemd service — start manually with: npm start"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
LOCAL_IP=$(ip route get 1.1.1.1 2>/dev/null | grep -oP 'src \K[^ ]+' || echo "localhost")
HOSTNAME=$(hostname)

echo ""
echo -e "${GRN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RST}"
echo -e "${GRN}  Installation complete!${RST}"
echo -e "${GRN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RST}"
echo ""
echo -e "  ${CYN}Start the server:${RST}"
echo    "    npm start"
echo    "    — or —"
echo    "    sudo systemctl start homepinas   (if service installed)"
echo ""
echo -e "  ${CYN}Access the dashboard:${RST}"
echo    "    https://${LOCAL_IP}"
echo    "    https://${HOSTNAME}.local"
echo    "    https://localhost"
echo ""
echo -e "  ${CYN}Important files:${RST}"
echo    "    .env                  ← environment variables (keep secret)"
echo    "    config/data.json      ← app data (created on first start)"
echo    "    backend/certs/        ← SSL certificates"
echo ""
echo -e "  ${YLW}⚠  Note: the browser will show a security warning for the${RST}"
echo -e "  ${YLW}   self-signed certificate. Click 'Advanced → Proceed'.${RST}"
echo ""
if ! [[ -d "${PROJECT_ROOT}/backend/routes" ]]; then
    echo -e "  ${RED}⚠  backend/routes/ is missing — API endpoints will fail to load.${RST}"
    echo -e "     This directory contains the route modules (/api/system, /api/storage, etc.)"
    echo -e "     and must be present for the server to function fully."
    echo ""
fi
