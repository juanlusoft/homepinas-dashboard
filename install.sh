#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# HomePiNAS Dashboard v3.5 — Installer
# Installs the dashboard on Raspberry Pi OS / Debian Bookworm / Ubuntu 22.04+
#
# Usage: curl -fsSL https://raw.githubusercontent.com/juanlusoft/homepinas-dashboard/main/install.sh | sudo bash
#        sudo bash install.sh
# ═══════════════════════════════════════════════════════════════════════════

set -euo pipefail

APP_VERSION="3.5.0"
REPO_URL="https://github.com/juanlusoft/homepinas-dashboard.git"
BRANCH="main"
INSTALL_DIR="/opt/homepinas"
SERVICE_NAME="homepinas"
NODE_MIN="20"

# ---------------------------------------------------------------------------
# Colours
# ---------------------------------------------------------------------------
RED='\033[0;31m'; GRN='\033[0;32m'; BLU='\033[0;34m'
YLW='\033[1;33m'; CYN='\033[0;36m'; NC='\033[0m'

info()  { echo -e "${BLU}[INFO]${NC}  $*"; }
ok()    { echo -e "${GRN}[OK]${NC}    $*"; }
warn()  { echo -e "${YLW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

pkg_installed() { dpkg -l "$1" 2>/dev/null | grep -q "^ii"; }

install_pkg() {
    local pkg="$1"
    if pkg_installed "$pkg"; then
        ok "$pkg already installed"
        return 0
    fi
    info "Installing $pkg..."
    if apt-get install -y -q "$pkg" >/dev/null 2>&1; then
        ok "$pkg installed"
    else
        warn "$pkg could not be installed — skipping (install manually if needed)"
        return 1
    fi
}

# ---------------------------------------------------------------------------
# Header
# ---------------------------------------------------------------------------
echo -e "${GRN}"
echo "  ╔══════════════════════════════════════════════════╗"
echo "  ║   HomePiNAS Dashboard v${APP_VERSION}                   ║"
echo "  ║   NAS Management Dashboard — Raspberry Pi       ║"
echo "  ╚══════════════════════════════════════════════════╝"
echo -e "${NC}"

# ---------------------------------------------------------------------------
# 1. Root check
# ---------------------------------------------------------------------------
[ "$(id -u)" -ne 0 ] && error "Run as root: sudo bash install.sh"

# Detect real user (the one who invoked sudo)
REAL_USER="${SUDO_USER:-$USER}"
if [[ "$REAL_USER" == "root" ]]; then
    warn "Running directly as root — service will run as root"
fi
info "Installing for user: ${REAL_USER}"

# ---------------------------------------------------------------------------
# 2. Architecture & distro detection
# ---------------------------------------------------------------------------
RAW_ARCH=$(uname -m)
case "$RAW_ARCH" in
    aarch64|arm64) SYS_ARCH="arm64" ;;
    armv7l|armhf)  SYS_ARCH="armhf" ;;
    x86_64)        SYS_ARCH="amd64" ;;
    *)             SYS_ARCH="$RAW_ARCH" ;;
esac
DEBIAN_CODENAME=$(. /etc/os-release 2>/dev/null && echo "${VERSION_CODENAME:-unknown}")
DISTRO_PRETTY=$(. /etc/os-release 2>/dev/null && echo "${PRETTY_NAME:-Linux}")
info "Arch: ${SYS_ARCH}  |  Distro: ${DISTRO_PRETTY}"

# ---------------------------------------------------------------------------
# 3. Package lists update
# ---------------------------------------------------------------------------
info "Updating package lists..."
apt-get update -qq
ok "Package lists updated"

# ---------------------------------------------------------------------------
# 4. Core build tools
# ---------------------------------------------------------------------------
info "Installing build essentials..."
for pkg in build-essential python3 git curl openssl ca-certificates gnupg; do
    install_pkg "$pkg"
done

# ---------------------------------------------------------------------------
# 5. Node.js >= 20 (installs LTS 22 if missing or too old)
# ---------------------------------------------------------------------------
install_node() {
    info "Installing Node.js v22 LTS via NodeSource..."
    # NodeSource setup script uses its own pipe — stdin is the inner curl, not ours
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null 2>&1
    apt-get install -y -q nodejs >/dev/null 2>&1
    ok "Node.js $(node --version) installed"
}

if command -v node &>/dev/null; then
    NODE_VER=$(node -e "process.stdout.write(process.version.slice(1).split('.')[0])")
    if [[ "$NODE_VER" -ge "$NODE_MIN" ]]; then
        ok "Node.js $(node --version) (>= ${NODE_MIN} ✓)"
    else
        warn "Node.js $(node --version) too old — need v${NODE_MIN}+"
        install_node
    fi
else
    install_node
fi

# ---------------------------------------------------------------------------
# 6. Docker + Docker Compose plugin
# ---------------------------------------------------------------------------
if ! command -v docker &>/dev/null; then
    info "Installing Docker..."
    # get.docker.com uses its own pipe — stdin is the inner curl, not ours
    curl -fsSL https://get.docker.com | sh >/dev/null 2>&1
    ok "Docker $(docker --version | awk '{print $3}' | tr -d ',') installed"
else
    ok "Docker $(docker --version | awk '{print $3}' | tr -d ',') found"
fi

systemctl enable --now docker >/dev/null 2>&1 || true

if ! id -nG "$REAL_USER" | grep -qw docker; then
    usermod -aG docker "$REAL_USER"
    ok "User ${REAL_USER} added to docker group (re-login required)"
fi

if ! docker compose version &>/dev/null 2>&1; then
    info "Installing Docker Compose plugin..."
    apt-get install -y -q docker-compose-plugin >/dev/null 2>&1 || {
        COMPOSE_VER=$(curl -fsSL https://api.github.com/repos/docker/compose/releases/latest \
            | grep '"tag_name"' | head -1 | cut -d'"' -f4)
        if [[ -z "$COMPOSE_VER" ]]; then
            warn "Could not determine Docker Compose version — install manually"
        else
            mkdir -p /usr/local/lib/docker/cli-plugins
            curl -fsSL \
                "https://github.com/docker/compose/releases/download/${COMPOSE_VER}/docker-compose-linux-$(uname -m)" \
                -o /usr/local/lib/docker/cli-plugins/docker-compose
            chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
        fi
    }
fi
# Report compose version without --short (not available in all versions)
COMPOSE_VER_OUT=$(docker compose version 2>/dev/null | awk '{print $NF}' || echo "unknown")
ok "Docker Compose ${COMPOSE_VER_OUT} ready"

# ---------------------------------------------------------------------------
# 7. Storage tools
# ---------------------------------------------------------------------------
info "Installing storage tools..."

# All packages here are optional — failure is warned, not fatal
for pkg in \
    ntfs-3g exfat-fuse exfatprogs \
    smartmontools \
    parted gdisk fdisk \
    e2fsprogs xfsprogs \
    util-linux \
    rsync \
    nfs-common nfs-kernel-server \
    samba samba-common-bin \
    wireguard wireguard-tools \
    qrencode \
    fuse3; do
    install_pkg "$pkg" || true
done

# snapraid — in Debian repos since Bullseye
if pkg_installed snapraid; then
    ok "snapraid already installed"
elif apt-get install -y -q snapraid >/dev/null 2>&1; then
    ok "snapraid installed"
else
    warn "snapraid not in repos for ${DEBIAN_CODENAME}/${SYS_ARCH} — install manually: https://www.snapraid.it"
fi

# mergerfs — NOT in standard repos, install from GitHub releases
if pkg_installed mergerfs || command -v mergerfs &>/dev/null; then
    ok "mergerfs already installed"
else
    info "Installing mergerfs from GitHub releases..."
    MERGERFS_VER=$(curl -fsSL https://api.github.com/repos/trapexit/mergerfs/releases/latest \
        2>/dev/null | grep '"tag_name"' | head -1 | cut -d'"' -f4)
    if [[ -n "$MERGERFS_VER" ]]; then
        CANDIDATES=(
            "mergerfs_${MERGERFS_VER}.debian-${DEBIAN_CODENAME}_${SYS_ARCH}.deb"
            "mergerfs_${MERGERFS_VER}_debian-${DEBIAN_CODENAME}_${SYS_ARCH}.deb"
            "mergerfs_${MERGERFS_VER}_${SYS_ARCH}.deb"
        )
        BASE_URL="https://github.com/trapexit/mergerfs/releases/download/${MERGERFS_VER}"
        MERGERFS_OK=0
        for fname in "${CANDIDATES[@]}"; do
            HTTP_CODE=$(curl -fsS --head -o /dev/null -w "%{http_code}" "${BASE_URL}/${fname}" 2>/dev/null || echo "000")
            if [[ "$HTTP_CODE" == "200" || "$HTTP_CODE" == "302" ]]; then
                if curl -fsSL "${BASE_URL}/${fname}" -o /tmp/mergerfs.deb 2>/dev/null; then
                    if dpkg -i /tmp/mergerfs.deb >/dev/null 2>&1; then
                        ok "mergerfs ${MERGERFS_VER} installed"
                        MERGERFS_OK=1
                    else
                        warn "mergerfs .deb downloaded but dpkg failed — run: apt-get install -f"
                    fi
                    rm -f /tmp/mergerfs.deb
                    break
                fi
            fi
        done
        [[ $MERGERFS_OK -eq 0 ]] && warn "mergerfs: no .deb for ${DEBIAN_CODENAME}/${SYS_ARCH} — install manually: https://github.com/trapexit/mergerfs/releases"
    else
        warn "mergerfs: could not fetch latest version from GitHub"
    fi
fi

# apcupsd — optional UPS support
install_pkg "apcupsd" || true

ok "Storage tools done"

# ---------------------------------------------------------------------------
# 8. Sudoers — passwordless for NAS management commands
# ---------------------------------------------------------------------------
info "Configuring sudoers for NAS tools..."
SUDOERS_FILE="/etc/sudoers.d/homepinas"
cat > "$SUDOERS_FILE" << SUDOERS
# HomePiNAS — passwordless sudo for NAS management tools
# Generated by install.sh on $(date -u +"%Y-%m-%dT%H:%M:%SZ")
${REAL_USER} ALL=(ALL) NOPASSWD: /usr/sbin/smartctl
${REAL_USER} ALL=(ALL) NOPASSWD: /sbin/sgdisk
${REAL_USER} ALL=(ALL) NOPASSWD: /sbin/parted
${REAL_USER} ALL=(ALL) NOPASSWD: /usr/sbin/parted
${REAL_USER} ALL=(ALL) NOPASSWD: /sbin/mkfs.ext4
${REAL_USER} ALL=(ALL) NOPASSWD: /sbin/mkfs.xfs
${REAL_USER} ALL=(ALL) NOPASSWD: /bin/mount
${REAL_USER} ALL=(ALL) NOPASSWD: /bin/umount
${REAL_USER} ALL=(ALL) NOPASSWD: /sbin/blkid
${REAL_USER} ALL=(ALL) NOPASSWD: /sbin/partprobe
${REAL_USER} ALL=(ALL) NOPASSWD: /usr/sbin/badblocks
${REAL_USER} ALL=(ALL) NOPASSWD: /usr/bin/rsync
${REAL_USER} ALL=(ALL) NOPASSWD: /usr/bin/snapraid
${REAL_USER} ALL=(ALL) NOPASSWD: /usr/bin/mergerfs
${REAL_USER} ALL=(ALL) NOPASSWD: /bin/cp
${REAL_USER} ALL=(ALL) NOPASSWD: /bin/mkdir
${REAL_USER} ALL=(ALL) NOPASSWD: /sbin/fdisk
${REAL_USER} ALL=(ALL) NOPASSWD: /usr/sbin/nmcli
${REAL_USER} ALL=(ALL) NOPASSWD: /usr/bin/systemctl
${REAL_USER} ALL=(ALL) NOPASSWD: /sbin/reboot
${REAL_USER} ALL=(ALL) NOPASSWD: /sbin/shutdown
${REAL_USER} ALL=(ALL) NOPASSWD: /usr/bin/apt
${REAL_USER} ALL=(ALL) NOPASSWD: /usr/bin/apcaccess
${REAL_USER} ALL=(ALL) NOPASSWD: /sbin/mkswap
${REAL_USER} ALL=(ALL) NOPASSWD: /sbin/swapon
${REAL_USER} ALL=(ALL) NOPASSWD: /sbin/swapoff
${REAL_USER} ALL=(ALL) NOPASSWD: /usr/sbin/exportfs
${REAL_USER} ALL=(ALL) NOPASSWD: /usr/bin/tee
${REAL_USER} ALL=(ALL) NOPASSWD: /usr/sbin/testparm
${REAL_USER} ALL=(ALL) NOPASSWD: /usr/bin/apt-get
${REAL_USER} ALL=(ALL) NOPASSWD: /usr/bin/wg
SUDOERS
chmod 0440 "$SUDOERS_FILE"
visudo -c -f "$SUDOERS_FILE" >/dev/null 2>&1 \
    && ok "Sudoers configured" \
    || warn "Sudoers syntax error — check ${SUDOERS_FILE}"

# ---------------------------------------------------------------------------
# 9. Clone / update repository
# ---------------------------------------------------------------------------
# NOTE: </dev/null on git clone is required when running via `curl | bash`
# because the outer pipe occupies stdin. Without it, git tries to negotiate
# credentials over stdin → GitHub closes the connection immediately.
# The repo is public so no credentials are needed; /dev/null is safe.
# ---------------------------------------------------------------------------
STAGING_DIR="${INSTALL_DIR}.staging"

if [[ -d "${INSTALL_DIR}" && -f "${INSTALL_DIR}/package.json" ]]; then
    info "Updating existing installation in ${INSTALL_DIR}..."
    cd "$INSTALL_DIR"
    git fetch origin "$BRANCH" --quiet </dev/null
    git reset --hard "origin/${BRANCH}" --quiet
    ok "Updated to latest ($(git log -1 --format='%h %s'))"
    cd "$INSTALL_DIR"
else
    info "Cloning repository to ${INSTALL_DIR}..."
    rm -rf "$STAGING_DIR"
    git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$STAGING_DIR" </dev/null \
        || error "git clone failed — check your internet connection"

    # Preserve config from a previous install
    if [[ -d "${INSTALL_DIR}/config" ]]; then
        info "Preserving existing config..."
        cp -a "${INSTALL_DIR}/config" "${STAGING_DIR}/config" 2>/dev/null || true
    fi
    if [[ -d "$INSTALL_DIR" ]]; then
        mv "$INSTALL_DIR" "${INSTALL_DIR}.backup.$(date +%s)"
        info "Previous install backed up"
    fi
    mv "$STAGING_DIR" "$INSTALL_DIR"
    ok "Repository cloned to ${INSTALL_DIR}"
fi

cd "$INSTALL_DIR"

# ---------------------------------------------------------------------------
# 10. npm install (compiles better-sqlite3 and node-pty)
# ---------------------------------------------------------------------------
info "Installing Node.js dependencies (may take a few minutes — compiling native modules)..."
if ! npm install --loglevel=error 2>/tmp/homepinas-npm.log; then
    error "npm install failed. Log:\n$(cat /tmp/homepinas-npm.log | tail -20)"
fi
rm -f /tmp/homepinas-npm.log
ok "Dependencies installed"

# ---------------------------------------------------------------------------
# 11. Required directories
# ---------------------------------------------------------------------------
info "Creating required directories..."

mkdir -p \
    "${INSTALL_DIR}/config" \
    "${INSTALL_DIR}/backend/certs"

# /mnt/storage only created if the path is already a mount point or doesn't exist
for dir in /mnt/storage /mnt/storage/.tmp /mnt/storage/.uploads-tmp; do
    if [[ "$dir" == "/mnt/storage" ]] || [[ -d /mnt/storage ]]; then
        mkdir -p "$dir" 2>/dev/null || true
    fi
done

# Ownership
chown -R "${REAL_USER}:${REAL_USER}" "$INSTALL_DIR"
for dir in /mnt/storage /mnt/cache /mnt/parity /mnt/disks; do
    [[ -d "$dir" ]] && chown -R "${REAL_USER}:${REAL_USER}" "$dir" 2>/dev/null || true
done

ok "Directories ready"

# ---------------------------------------------------------------------------
# 12. Environment file
# ---------------------------------------------------------------------------
info "Setting up environment variables..."

ENV_FILE="${INSTALL_DIR}/.env"

if [[ -f "$ENV_FILE" ]]; then
    ok ".env already exists — skipping (delete to regenerate)"
else
    TOTP_KEY=$(openssl rand -hex 32 2>/dev/null \
        || node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))")

    cat > "$ENV_FILE" << EOF
# HomePiNAS Dashboard v${APP_VERSION} — Environment Configuration
# Generated by install.sh on $(date -u +"%Y-%m-%dT%H:%M:%SZ")
# DO NOT COMMIT THIS FILE

# Server ports (80/443 require running as root or CAP_NET_BIND_SERVICE)
HTTPS_PORT=443
HTTP_PORT=80

# Session settings (milliseconds)
SESSION_DURATION=86400000       # 24 hours
SESSION_IDLE_TIMEOUT=3600000    # 1 hour

# Health monitor thresholds
TEMP_THRESHOLD_C=75             # Disk temperature alert (°C)
POOL_USAGE_THRESHOLD=85         # Storage pool usage alert (%)

# TOTP secret encryption key (AES-256-GCM, 32 bytes hex)
# KEEP SECRET — rotating invalidates all existing 2FA registrations
TOTP_SERVER_KEY=${TOTP_KEY}

# Runtime
NODE_ENV=production
LOG_LEVEL=info
EOF

    chmod 600 "$ENV_FILE"
    chown "${REAL_USER}:${REAL_USER}" "$ENV_FILE"
    ok ".env created"
    warn "TOTP_SERVER_KEY generated — back it up, losing it invalidates all 2FA"
fi

# ---------------------------------------------------------------------------
# 13. SSL certificates
# ---------------------------------------------------------------------------
info "Setting up SSL certificates..."

CERT_PATH="${INSTALL_DIR}/backend/certs/server.crt"
KEY_PATH="${INSTALL_DIR}/backend/certs/server.key"

if [[ -f "$CERT_PATH" && -f "$KEY_PATH" ]]; then
    EXPIRY=$(openssl x509 -enddate -noout -in "$CERT_PATH" 2>/dev/null | cut -d= -f2 || echo "unknown")
    ok "SSL certificates already present (expires: ${EXPIRY})"
elif command -v openssl &>/dev/null; then
    HOSTNAME=$(hostname)
    LOCAL_IP=$(ip route get 1.1.1.1 2>/dev/null | grep -oP 'src \K[^ ]+' || echo "127.0.0.1")
    SSL_CNF="/tmp/homepinas-ssl.cnf"
    cat > "$SSL_CNF" << SSLCONF
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
SSLCONF

    openssl req -x509 -nodes -days 3650 \
        -newkey rsa:2048 \
        -keyout "$KEY_PATH" \
        -out "$CERT_PATH" \
        -config "$SSL_CNF" 2>/dev/null
    chmod 600 "$KEY_PATH"
    chown -R "${REAL_USER}:${REAL_USER}" "${INSTALL_DIR}/backend/certs"
    rm -f "$SSL_CNF"
    ok "Self-signed certificate generated (10 years, CN=${HOSTNAME}, IP=${LOCAL_IP})"
    warn "Browser will show a security warning — expected for self-signed certs"
else
    warn "openssl not found — certificate will be auto-generated on first server start"
fi

# ---------------------------------------------------------------------------
# 14. Systemd service
# ---------------------------------------------------------------------------
info "Installing systemd service..."

TSX_BIN="${INSTALL_DIR}/node_modules/.bin/tsx"
[[ -f "$TSX_BIN" ]] || error "tsx not found at ${TSX_BIN} — npm install may have failed"

cat > "/etc/systemd/system/${SERVICE_NAME}.service" << SERVICE
[Unit]
Description=HomePiNAS Dashboard v${APP_VERSION}
Documentation=https://github.com/juanlusoft/homepinas-dashboard
After=network-online.target docker.service
Wants=network-online.target docker.service

[Service]
Type=simple
User=${REAL_USER}
Group=${REAL_USER}
WorkingDirectory=${INSTALL_DIR}
EnvironmentFile=${ENV_FILE}
ExecStart=${TSX_BIN} ${INSTALL_DIR}/backend/index.ts
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=homepinas

# Allow binding to ports < 1024
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE

# Hardening (light — smartctl/parted need elevated paths)
NoNewPrivileges=no
PrivateTmp=yes
ProtectSystem=full
ProtectHome=read-only
ReadWritePaths=${INSTALL_DIR}/config ${INSTALL_DIR}/backend/certs /mnt/storage /mnt/cache /mnt/parity /mnt/disks /tmp

[Install]
WantedBy=multi-user.target
SERVICE

systemctl daemon-reload
systemctl enable "$SERVICE_NAME"
ok "Service installed and enabled"

# ---------------------------------------------------------------------------
# 15. Start service
# ---------------------------------------------------------------------------
info "Starting HomePiNAS service..."
systemctl restart "$SERVICE_NAME"
sleep 5

if systemctl is-active --quiet "$SERVICE_NAME"; then
    ok "Service started successfully"
else
    warn "Service did not start — check logs: journalctl -u ${SERVICE_NAME} -n 30 --no-pager"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
LOCAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "localhost")
HOSTNAME=$(hostname)

echo ""
echo -e "${GRN}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${GRN}║   HomePiNAS Dashboard v${APP_VERSION} installed!            ║${NC}"
echo -e "${GRN}╠══════════════════════════════════════════════════════╣${NC}"
echo -e "${GRN}║${NC}                                                      "
echo -e "${GRN}║${NC}   ${CYN}Access:${NC}                                           "
echo -e "${GRN}║${NC}     https://${LOCAL_IP}                               "
echo -e "${GRN}║${NC}     https://${HOSTNAME}.local                      "
echo -e "${GRN}║${NC}                                                      "
echo -e "${GRN}║${NC}   ${CYN}Service:${NC}                                          "
echo -e "${GRN}║${NC}     sudo systemctl status ${SERVICE_NAME}               "
echo -e "${GRN}║${NC}     sudo journalctl -u ${SERVICE_NAME} -n 30           "
echo -e "${GRN}║${NC}                                                      "
echo -e "${GRN}║${NC}   ${CYN}Files:${NC}                                            "
echo -e "${GRN}║${NC}     Install:  ${INSTALL_DIR}/                        "
echo -e "${GRN}║${NC}     Env:      ${ENV_FILE}                "
echo -e "${GRN}║${NC}     Certs:    ${INSTALL_DIR}/backend/certs/         "
echo -e "${GRN}║${NC}     Config:   ${INSTALL_DIR}/config/                "
echo -e "${GRN}║${NC}                                                      "
echo -e "${GRN}╚══════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${YLW}⚠  Browser will show a security warning for the self-signed cert.${NC}"
echo -e "     Click 'Advanced → Proceed' or install the cert in your trust store."
echo ""
echo -e "  ${CYN}Re-login or run 'newgrp docker' to use Docker without sudo.${NC}"
echo ""
