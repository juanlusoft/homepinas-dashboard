#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# HomePiNAS Dashboard v3.5 — Installer
# Compatible: Raspberry Pi OS / Debian 12 Bookworm / Debian 13 Trixie / Ubuntu 22.04+
#
# Usage: curl -fsSL https://raw.githubusercontent.com/juanlusoft/homepinas-dashboard/main/install.sh | sudo bash
#        sudo bash install.sh
# ═══════════════════════════════════════════════════════════════════════════

set -euo pipefail

# ─── CRÍTICO ───────────────────────────────────────────────────────────────
# Debe establecerse ANTES de cualquier llamada a apt/dpkg.
# Sin esto los diálogos de debconf (samba, apcupsd…) se quedan esperando
# input interactivo aunque stdout esté redirigido, bloqueando para siempre.
export DEBIAN_FRONTEND=noninteractive
export DEBCONF_NONINTERACTIVE_SEEN=true

# ─── Constantes ────────────────────────────────────────────────────────────
APP_VERSION="3.5.0"
REPO_URL="https://github.com/juanlusoft/homepinas-dashboard.git"
BRANCH="main"
INSTALL_DIR="/opt/homepinas"
SERVICE_NAME="homepinas"
NODE_MIN="20"

# Opciones globales de curl — añade timeout para evitar colgar en red lenta
CURL="curl --connect-timeout 30 --max-time 300 -fsSL"

# Opciones globales de apt — timeout de red + reintentos automáticos
APT_OPTS="-y -q -o Acquire::http::Timeout=60 -o Acquire::Retries=3 -o DPkg::Options::=--force-confold"

# ─── Colores ───────────────────────────────────────────────────────────────
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
    # shellcheck disable=SC2086
    if apt-get install $APT_OPTS "$pkg" > /tmp/homepinas-apt.log 2>&1; then
        ok "$pkg installed"
    else
        warn "$pkg could not be installed — skipping (install manually if needed)"
        return 1
    fi
}

# ─── Policy-rc.d ────────────────────────────────────────────────────────────
# Impide que los servicios recién instalados arranquen automáticamente.
# Sin esto samba, nfs, apcupsd y docker consumen RAM justo antes de
# compilar los módulos nativos de Node, provocando OOM en Raspberry Pi.
_policy_installed=0
block_service_starts() {
    if [[ ! -f /usr/sbin/policy-rc.d ]]; then
        cat > /usr/sbin/policy-rc.d << 'POLICY'
#!/bin/sh
# HomePiNAS installer: prevent services from auto-starting during apt
exit 101
POLICY
        chmod +x /usr/sbin/policy-rc.d
        _policy_installed=1
        info "Service auto-start blocked during installation"
    fi
}

restore_service_starts() {
    if [[ "$_policy_installed" -eq 1 && -f /usr/sbin/policy-rc.d ]]; then
        rm -f /usr/sbin/policy-rc.d
        _policy_installed=0
        info "Service auto-start restored"
    fi
}

# ─── Swap helper ────────────────────────────────────────────────────────────
# Expande swap antes de compilar módulos nativos.
# Soporta dphys-swapfile (Raspberry Pi OS / Bookworm) y swapfile manual
# (Debian 13 Trixie usa zram en lugar de dphys-swapfile).
_SWAP_METHOD=""   # "dphys" | "file" | ""
_ORIG_SWAP=0
_SWAPFILE="/swapfile_homepinas_tmp"

expand_swap() {
    local target_mb=1024
    local current_mb
    current_mb=$(free -m | awk '/^Swap:/{print $2}')

    if [[ "${current_mb:-0}" -ge "$target_mb" ]]; then
        ok "Swap already ${current_mb} MB — no expansion needed"
        return 0
    fi

    if [[ -f /etc/dphys-swapfile ]] && command -v dphys-swapfile &>/dev/null; then
        _ORIG_SWAP=$(grep '^CONF_SWAPSIZE=' /etc/dphys-swapfile 2>/dev/null | cut -d= -f2 || echo "100")
        info "Expanding swap to ${target_mb} MB via dphys-swapfile..."
        sed -i "s/^CONF_SWAPSIZE=.*/CONF_SWAPSIZE=${target_mb}/" /etc/dphys-swapfile
        if dphys-swapfile setup >/dev/null 2>&1 && dphys-swapfile swapon >/dev/null 2>&1; then
            _SWAP_METHOD="dphys"
            ok "Swap expanded to ${target_mb} MB"
        else
            sed -i "s/^CONF_SWAPSIZE=.*/CONF_SWAPSIZE=${_ORIG_SWAP}/" /etc/dphys-swapfile
            warn "dphys-swapfile expansion failed — compilation may be slow on low-RAM devices"
        fi
    else
        # Trixie / Ubuntu: crear swapfile manual
        local free_mb
        free_mb=$(df / --output=avail -m 2>/dev/null | tail -1 | tr -d ' ')
        if [[ "${free_mb:-0}" -gt "$((target_mb + 512))" ]]; then
            info "Creating temporary ${target_mb} MB swapfile (no dphys-swapfile found)..."
            if dd if=/dev/zero of="$_SWAPFILE" bs=1M count="$target_mb" status=none 2>/dev/null \
                && chmod 600 "$_SWAPFILE" \
                && mkswap "$_SWAPFILE" >/dev/null 2>&1 \
                && swapon "$_SWAPFILE" 2>/dev/null; then
                _SWAP_METHOD="file"
                ok "Temporary swapfile created and activated"
            else
                rm -f "$_SWAPFILE"
                warn "Could not create swapfile — compilation may fail on low-RAM devices"
            fi
        else
            warn "Not enough disk space to create swapfile (need ${target_mb}+ MB free on /)"
        fi
    fi
}

restore_swap() {
    case "$_SWAP_METHOD" in
        dphys)
            info "Restoring swap to ${_ORIG_SWAP} MB..."
            sed -i "s/^CONF_SWAPSIZE=.*/CONF_SWAPSIZE=${_ORIG_SWAP}/" /etc/dphys-swapfile
            dphys-swapfile setup >/dev/null 2>&1 && dphys-swapfile swapon >/dev/null 2>&1 || true
            ok "Swap restored to ${_ORIG_SWAP} MB"
            ;;
        file)
            info "Removing temporary swapfile..."
            swapoff "$_SWAPFILE" 2>/dev/null || true
            rm -f "$_SWAPFILE"
            ok "Temporary swapfile removed"
            ;;
    esac
    _SWAP_METHOD=""
}

# ─── Cabecera ───────────────────────────────────────────────────────────────
echo -e "${GRN}"
echo "  ╔══════════════════════════════════════════════════╗"
echo "  ║   HomePiNAS Dashboard v${APP_VERSION}                   ║"
echo "  ║   NAS Management Dashboard — Raspberry Pi       ║"
echo "  ╚══════════════════════════════════════════════════╝"
echo -e "${NC}"

# ─── 1. Root check ──────────────────────────────────────────────────────────
[ "$(id -u)" -ne 0 ] && error "Run as root: sudo bash install.sh"

REAL_USER="${SUDO_USER:-$USER}"
[[ "$REAL_USER" == "root" ]] && warn "Running directly as root — service will run as root"
info "Installing for user: ${REAL_USER}"

# ─── 1b. Disk space ─────────────────────────────────────────────────────────
FREE_MB=$(df / --output=avail -m 2>/dev/null | tail -1 | tr -d ' ')
if [[ -n "$FREE_MB" && "$FREE_MB" -lt 2048 ]]; then
    error "Not enough disk space: ${FREE_MB} MB free, need at least 2048 MB.\nCheck: ls /opt/homepinas.backup.* 2>/dev/null"
fi
ok "Disk space: ${FREE_MB} MB free"

# ─── 2. Arquitectura y distro ────────────────────────────────────────────────
RAW_ARCH=$(uname -m)
case "$RAW_ARCH" in
    aarch64|arm64) SYS_ARCH="arm64" ;;
    armv7l|armhf)  SYS_ARCH="armhf" ;;
    x86_64)        SYS_ARCH="amd64" ;;
    *)             SYS_ARCH="$RAW_ARCH" ;;
esac
DEBIAN_CODENAME=$(. /etc/os-release 2>/dev/null && echo "${VERSION_CODENAME:-unknown}")
DISTRO_PRETTY=$(. /etc/os-release 2>/dev/null && echo "${PRETTY_NAME:-Linux}")
info "Arch: ${SYS_ARCH}  |  Distro: ${DISTRO_PRETTY}  |  Codename: ${DEBIAN_CODENAME}"

# ─── 3. Bloquear arranque de servicios durante la instalación ────────────────
block_service_starts

# ─── 4. Actualizar listas de paquetes ────────────────────────────────────────
info "Updating package lists..."
# shellcheck disable=SC2086
apt-get update $APT_OPTS 2>/dev/null || apt-get update -y 2>/dev/null || true
ok "Package lists updated"

# ─── 5. Herramientas base de compilación ────────────────────────────────────
info "Installing build essentials..."
# shellcheck disable=SC2086
apt-get install $APT_OPTS \
    build-essential python3 git curl openssl ca-certificates gnupg lsb-release \
    >/dev/null 2>&1
ok "Build essentials installed"

# ─── 6. Node.js >= 20 ────────────────────────────────────────────────────────
install_node() {
    info "Installing Node.js v22 LTS via NodeSource..."

    # NodeSource no siempre soporta Trixie (Debian 13) de inmediato.
    # Si el codename no está soportado, usamos "bookworm" como fallback.
    local ns_codename="$DEBIAN_CODENAME"
    case "$DEBIAN_CODENAME" in
        trixie|forky|sid|unstable|testing)
            warn "NodeSource may not support '${DEBIAN_CODENAME}' yet — using 'bookworm' as fallback"
            ns_codename="bookworm"
            ;;
    esac

    # Añadir repositorio NodeSource manualmente (sin pipe a bash, más seguro)
    local keyring="/usr/share/keyrings/nodesource.gpg"
    mkdir -p /usr/share/keyrings
    if $CURL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
        | gpg --dearmor --yes -o "$keyring" 2>/dev/null; then
        echo "deb [signed-by=${keyring}] https://deb.nodesource.com/node_22.x nodistro main" \
            > /etc/apt/sources.list.d/nodesource.list
        # shellcheck disable=SC2086
        apt-get update $APT_OPTS 2>/dev/null || true
        # shellcheck disable=SC2086
        if apt-get install $APT_OPTS nodejs 2>/dev/null; then
            ok "Node.js $(node --version) installed from NodeSource"
            return 0
        fi
    fi

    # Fallback: NodeSource setup script con codename corregido
    warn "NodeSource direct install failed — trying setup script..."
    if $CURL "https://deb.nodesource.com/setup_22.x" -o /tmp/ns_setup.sh 2>/dev/null; then
        # Reemplazar codename si es Trixie
        sed -i "s/DISTRO=.*/DISTRO=${ns_codename}/" /tmp/ns_setup.sh 2>/dev/null || true
        bash /tmp/ns_setup.sh >/dev/null 2>&1 || true
        rm -f /tmp/ns_setup.sh
        # shellcheck disable=SC2086
        apt-get install $APT_OPTS nodejs >/dev/null 2>&1 && {
            ok "Node.js $(node --version) installed"
            return 0
        }
    fi

    # Último fallback: node del repositorio Debian (puede ser más antiguo)
    warn "NodeSource failed — installing node from Debian repos (may be older)..."
    # shellcheck disable=SC2086
    apt-get install $APT_OPTS nodejs npm >/dev/null 2>&1 || error "Could not install Node.js — install manually"
    ok "Node.js $(node --version) installed from Debian repos"
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

# ─── 7. Docker + Docker Compose plugin ───────────────────────────────────────
install_docker() {
    info "Installing Docker via official apt repository..."

    local keyring="/usr/share/keyrings/docker.gpg"
    mkdir -p /usr/share/keyrings

    # get.docker.com usa lsb_release para el codename. Trixie puede no estar
    # en su lista; usamos la instalación manual con el repo de Docker.
    local docker_codename="$DEBIAN_CODENAME"
    case "$DEBIAN_CODENAME" in
        trixie|forky|sid|testing)
            warn "Docker repo may not have '${DEBIAN_CODENAME}' — using 'bookworm' repo"
            docker_codename="bookworm"
            ;;
    esac

    # Detectar ID de distro (debian / ubuntu / raspbian)
    local distro_id
    distro_id=$(. /etc/os-release 2>/dev/null && echo "${ID:-debian}")
    # Raspberry Pi OS se reporta como "raspbian" pero usa el repo de "debian"
    [[ "$distro_id" == "raspbian" ]] && distro_id="debian"

    # Añadir clave GPG de Docker
    if $CURL "https://download.docker.com/linux/${distro_id}/gpg" \
        | gpg --dearmor --yes -o "$keyring" 2>/dev/null; then
        echo "deb [arch=${SYS_ARCH} signed-by=${keyring}] https://download.docker.com/linux/${distro_id} ${docker_codename} stable" \
            > /etc/apt/sources.list.d/docker.list
        # shellcheck disable=SC2086
        apt-get update $APT_OPTS 2>/dev/null || true
        # shellcheck disable=SC2086
        if apt-get install $APT_OPTS docker-ce docker-ce-cli containerd.io docker-compose-plugin 2>/dev/null; then
            ok "Docker $(docker --version | awk '{print $3}' | tr -d ',') installed (official repo)"
            return 0
        fi
    fi

    # Fallback: get.docker.com
    warn "Docker apt repo failed — trying get.docker.com..."
    if $CURL https://get.docker.com -o /tmp/docker_install.sh 2>/dev/null; then
        bash /tmp/docker_install.sh >/dev/null 2>&1 || true
        rm -f /tmp/docker_install.sh
        command -v docker &>/dev/null && {
            ok "Docker $(docker --version | awk '{print $3}' | tr -d ',') installed (get.docker.com)"
            return 0
        }
    fi

    # Último fallback: docker.io del repo Debian
    warn "get.docker.com failed — installing docker.io from Debian repos..."
    # shellcheck disable=SC2086
    apt-get install $APT_OPTS docker.io docker-compose >/dev/null 2>&1 \
        && ok "docker.io installed from Debian repos" \
        || warn "Docker could not be installed — install manually"
}

if ! command -v docker &>/dev/null; then
    install_docker
else
    ok "Docker $(docker --version | awk '{print $3}' | tr -d ',') found"
fi

# Habilitar Docker (ignorar error si no está instalado)
systemctl enable --now docker >/dev/null 2>&1 || true

if ! id -nG "$REAL_USER" | grep -qw docker; then
    usermod -aG docker "$REAL_USER" 2>/dev/null || true
    ok "User ${REAL_USER} added to docker group (re-login required)"
fi

# Verificar docker compose (plugin o standalone)
if ! docker compose version &>/dev/null 2>&1; then
    info "Installing Docker Compose plugin..."
    # shellcheck disable=SC2086
    apt-get install $APT_OPTS docker-compose-plugin >/dev/null 2>&1 || {
        COMPOSE_VER=$($CURL https://api.github.com/repos/docker/compose/releases/latest \
            2>/dev/null | grep '"tag_name"' | head -1 | cut -d'"' -f4 || echo "")
        if [[ -n "$COMPOSE_VER" ]]; then
            mkdir -p /usr/local/lib/docker/cli-plugins
            $CURL "https://github.com/docker/compose/releases/download/${COMPOSE_VER}/docker-compose-linux-$(uname -m)" \
                -o /usr/local/lib/docker/cli-plugins/docker-compose 2>/dev/null && \
            chmod +x /usr/local/lib/docker/cli-plugins/docker-compose || \
            warn "Docker Compose plugin could not be installed"
        else
            warn "Could not determine Docker Compose version — install manually"
        fi
    }
fi
COMPOSE_VER_OUT=$(docker compose version 2>/dev/null | awk '{print $NF}' || echo "unknown")
ok "Docker Compose ${COMPOSE_VER_OUT} ready"

# ─── 8. Herramientas de almacenamiento ───────────────────────────────────────
info "Installing storage tools..."

# Instalar en grupos para que un fallo no bloquee los demás.
# Nota: wireguard-tools ONLY (no "wireguard" — en kernels ARM puede
# intentar compilar módulo DKMS y desbordarse en RAM).
# apcupsd se instala pero se deshabilita — solo para poder usarlo desde la UI.
_STORAGE_PKGS=(
    ntfs-3g exfat-fuse exfatprogs
    smartmontools
    parted gdisk fdisk e2fsprogs xfsprogs util-linux
    rsync
    nfs-common nfs-kernel-server
    samba samba-common-bin
    wireguard-tools
    qrencode
    fuse3
)

for pkg in "${_STORAGE_PKGS[@]}"; do
    install_pkg "$pkg" || true
done

# snapraid
if pkg_installed snapraid; then
    ok "snapraid already installed"
# shellcheck disable=SC2086
elif apt-get install $APT_OPTS snapraid >/dev/null 2>&1; then
    ok "snapraid installed"
else
    warn "snapraid not in repos for ${DEBIAN_CODENAME}/${SYS_ARCH} — install manually: https://www.snapraid.it"
fi

# mergerfs — no está en repos estándar, instalar desde GitHub releases
if pkg_installed mergerfs || command -v mergerfs &>/dev/null; then
    ok "mergerfs already installed"
else
    info "Installing mergerfs from GitHub releases..."
    MERGERFS_VER=$($CURL https://api.github.com/repos/trapexit/mergerfs/releases/latest \
        2>/dev/null | grep '"tag_name"' | head -1 | cut -d'"' -f4 || echo "")
    if [[ -n "$MERGERFS_VER" ]]; then
        # Intentar múltiples naming conventions que mergerfs ha usado en distintas versiones
        _MFS_CODENAME="$DEBIAN_CODENAME"
        # Si Trixie, intentar también con bookworm
        [[ "$DEBIAN_CODENAME" == "trixie" ]] && _MFS_FALLBACK="bookworm" || _MFS_FALLBACK=""
        CANDIDATES=(
            "mergerfs_${MERGERFS_VER}.debian-${_MFS_CODENAME}_${SYS_ARCH}.deb"
            "mergerfs_${MERGERFS_VER}_debian-${_MFS_CODENAME}_${SYS_ARCH}.deb"
        )
        [[ -n "$_MFS_FALLBACK" ]] && CANDIDATES+=(
            "mergerfs_${MERGERFS_VER}.debian-${_MFS_FALLBACK}_${SYS_ARCH}.deb"
            "mergerfs_${MERGERFS_VER}_debian-${_MFS_FALLBACK}_${SYS_ARCH}.deb"
        )
        CANDIDATES+=("mergerfs_${MERGERFS_VER}_${SYS_ARCH}.deb")

        BASE_URL="https://github.com/trapexit/mergerfs/releases/download/${MERGERFS_VER}"
        MERGERFS_OK=0
        for fname in "${CANDIDATES[@]}"; do
            HTTP_CODE=$($CURL --head -o /dev/null -w "%{http_code}" "${BASE_URL}/${fname}" 2>/dev/null || echo "000")
            if [[ "$HTTP_CODE" == "200" || "$HTTP_CODE" == "302" ]]; then
                if $CURL "${BASE_URL}/${fname}" -o /tmp/mergerfs.deb 2>/dev/null; then
                    # shellcheck disable=SC2086
                    if dpkg -i /tmp/mergerfs.deb >/dev/null 2>&1 || apt-get install $APT_OPTS -f >/dev/null 2>&1; then
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
        [[ $MERGERFS_OK -eq 0 ]] && warn "mergerfs: no .deb for ${DEBIAN_CODENAME}/${SYS_ARCH} — https://github.com/trapexit/mergerfs/releases"
    else
        warn "mergerfs: could not fetch latest version from GitHub"
    fi
fi

# apcupsd: instalar pero deshabilitar inmediatamente.
# Consume RAM y puede fallar si no hay SAI conectado.
if install_pkg "apcupsd"; then
    systemctl stop apcupsd 2>/dev/null || true
    systemctl disable apcupsd 2>/dev/null || true
    ok "apcupsd installed and disabled (enable via UI when UPS is connected)"
fi

ok "Storage tools done"

# ─── 9. Restaurar arranque de servicios y gestionar los recién instalados ────
restore_service_starts

# Detener y deshabilitar servicios que se habrían iniciado sí o sí.
# Así liberamos RAM antes de la compilación de módulos nativos.
for svc in smbd nmbd winbind nfs-server nfs-kernel-server; do
    systemctl stop "$svc" 2>/dev/null || true
    systemctl disable "$svc" 2>/dev/null || true
done
ok "Samba and NFS services disabled (enable via UI if needed)"

# ─── 10. Sudoers ────────────────────────────────────────────────────────────
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

# ─── 11. Clonar / actualizar repositorio ────────────────────────────────────
# NOTA: </dev/null en git clone es necesario cuando se ejecuta via `curl | bash`
# porque el pipe externo ocupa stdin. Sin él git intenta negociar credenciales
# por stdin → GitHub cierra la conexión. El repo es público, /dev/null es seguro.
STAGING_DIR="${INSTALL_DIR}.staging"

if [[ -d "${INSTALL_DIR}" && -f "${INSTALL_DIR}/package.json" ]]; then
    info "Updating existing installation in ${INSTALL_DIR}..."
    cd "$INSTALL_DIR"
    git fetch origin "$BRANCH" --quiet </dev/null
    git reset --hard "origin/${BRANCH}" --quiet
    ok "Updated to latest ($(git log -1 --format='%h %s'))"
else
    info "Cloning repository to ${INSTALL_DIR}..."
    rm -rf "$STAGING_DIR"
    git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$STAGING_DIR" </dev/null \
        || error "git clone failed — check your internet connection"

    # Preservar config de instalación anterior
    if [[ -d "${INSTALL_DIR}/config" ]]; then
        info "Preserving existing config..."
        cp -a "${INSTALL_DIR}/config" "${STAGING_DIR}/config" 2>/dev/null || true
    fi

    _NEW_DIR="${INSTALL_DIR}.new"
    rm -rf "$_NEW_DIR"
    mv "$STAGING_DIR" "$_NEW_DIR"

    if [[ -d "$INSTALL_DIR" ]]; then
        BACKUP_DIR="${INSTALL_DIR}.backup.$(date +%s)"
        mv "$INSTALL_DIR" "$BACKUP_DIR"
        # node_modules ~200 MB, se regenera con npm install — no hace falta en el backup
        rm -rf "${BACKUP_DIR}/node_modules" 2>/dev/null || true
        info "Previous install backed up to $(basename "$BACKUP_DIR") (node_modules excluded)"
    fi
    mv "$_NEW_DIR" "$INSTALL_DIR"
    ok "Repository cloned to ${INSTALL_DIR}"

    # Conservar solo los 2 backups más recientes
    mapfile -t _OLD_BACKUPS < <(ls -dt "${INSTALL_DIR}.backup."* 2>/dev/null | tail -n +3)
    if [[ ${#_OLD_BACKUPS[@]} -gt 0 ]]; then
        info "Removing ${#_OLD_BACKUPS[@]} old backup(s) to free disk space..."
        rm -rf "${_OLD_BACKUPS[@]}"
    fi
fi

cd "$INSTALL_DIR"

# ─── 12. npm install (compila better-sqlite3 y node-pty) ────────────────────
info "Installing Node.js dependencies (may take a few minutes — compiling native modules)..."

# Expandir swap antes de compilar módulos nativos.
# better-sqlite3 + node-pty en paralelo pueden picar 500 MB RAM
# y matar procesos del sistema por OOM en Raspberry Pi de 1-2 GB.
expand_swap

# --jobs=1 serializa la compilación C++ para evitar OOM paralelo en Pi
# NODE_OPTIONS limita el heap del proceso Node a 256 MB
if ! NODE_OPTIONS="--max-old-space-size=256" \
   npm install --loglevel=error --jobs=1 2>/tmp/homepinas-npm.log; then
    restore_swap
    error "npm install failed. Log:\n$(tail -20 /tmp/homepinas-npm.log)"
fi
rm -f /tmp/homepinas-npm.log
ok "Dependencies installed"

restore_swap

# ─── 13. Directorios requeridos ──────────────────────────────────────────────
info "Creating required directories..."

mkdir -p \
    "${INSTALL_DIR}/config" \
    "${INSTALL_DIR}/backend/certs"

# /mnt/storage solo si el path ya existe o no es un punto de montaje activo
for dir in /mnt/storage /mnt/storage/.tmp /mnt/storage/.uploads-tmp; do
    mkdir -p "$dir" 2>/dev/null || true
done

# IMPORTANTE: chown SIN -R en puntos de montaje.
# Un chown -R sobre discos montados puede tardar horas en discos grandes y
# bloquear el instalador indefinidamente mientras recorre millones de inodos.
chown -R "${REAL_USER}:${REAL_USER}" "$INSTALL_DIR"

# Solo cambiar el propietario del directorio raíz (no recursivo) en los mount points
for dir in /mnt/storage /mnt/cache /mnt/parity /mnt/disks; do
    [[ -d "$dir" ]] && chown "${REAL_USER}:${REAL_USER}" "$dir" 2>/dev/null || true
done

ok "Directories ready"

# ─── 14. Variables de entorno (.env) ────────────────────────────────────────
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

# ─── 15. Certificados SSL ────────────────────────────────────────────────────
info "Setting up SSL certificates..."

CERT_PATH="${INSTALL_DIR}/backend/certs/server.crt"
KEY_PATH="${INSTALL_DIR}/backend/certs/server.key"

if [[ -f "$CERT_PATH" && -f "$KEY_PATH" ]]; then
    EXPIRY=$(openssl x509 -enddate -noout -in "$CERT_PATH" 2>/dev/null | cut -d= -f2 || echo "unknown")
    ok "SSL certificates already present (expires: ${EXPIRY})"
elif command -v openssl &>/dev/null; then
    CERT_HOSTNAME=$(hostname)
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
CN = ${CERT_HOSTNAME}

[v3_req]
keyUsage = critical, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names

[alt_names]
DNS.1 = ${CERT_HOSTNAME}
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
    ok "Self-signed certificate generated (10 years, CN=${CERT_HOSTNAME}, IP=${LOCAL_IP})"
    warn "Browser will show a security warning — expected for self-signed certs"
else
    warn "openssl not found — certificate will be auto-generated on first server start"
fi

# ─── 16. Servicio systemd ────────────────────────────────────────────────────
info "Installing systemd service..."

TSX_BIN="${INSTALL_DIR}/node_modules/.bin/tsx"
[[ -f "$TSX_BIN" ]] || error "tsx not found at ${TSX_BIN} — npm install may have failed"

cat > "/etc/systemd/system/${SERVICE_NAME}.service" << SERVICE
[Unit]
Description=HomePiNAS Dashboard v${APP_VERSION}
Documentation=https://github.com/juanlusoft/homepinas-dashboard
After=network-online.target docker.service
Wants=network-online.target docker.service
# Dejar de reintentar tras 5 fallos en 60 s — evita bucle CPU/RAM en Pi
StartLimitBurst=5
StartLimitIntervalSec=60

[Service]
Type=simple
User=${REAL_USER}
Group=${REAL_USER}
WorkingDirectory=${INSTALL_DIR}
EnvironmentFile=${ENV_FILE}
# Limitar heap de Node a 256 MB — tsx transpila TypeScript on-the-fly y puede
# agotar la RAM del Pi sin este límite, provocando crasheos OOM repetidos
Environment=NODE_OPTIONS=--max-old-space-size=256
ExecStart=${TSX_BIN} ${INSTALL_DIR}/backend/index.ts
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=homepinas

# Permitir binding a puertos < 1024
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE

# Hardening (light — smartctl/parted necesitan rutas elevadas)
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

# ─── 17. Arrancar servicio ───────────────────────────────────────────────────
info "Starting HomePiNAS service..."
systemctl restart "$SERVICE_NAME"
sleep 5

if systemctl is-active --quiet "$SERVICE_NAME"; then
    ok "Service started successfully"
else
    warn "Service did not start — check logs: journalctl -u ${SERVICE_NAME} -n 30 --no-pager"
fi

# ─── Resumen final ───────────────────────────────────────────────────────────
LOCAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "localhost")
SUMMARY_HOSTNAME=$(hostname)

echo ""
echo -e "${GRN}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${GRN}║   HomePiNAS Dashboard v${APP_VERSION} installed!            ║${NC}"
echo -e "${GRN}╠══════════════════════════════════════════════════════╣${NC}"
echo -e "${GRN}║${NC}                                                      "
echo -e "${GRN}║${NC}   ${CYN}Access:${NC}                                           "
echo -e "${GRN}║${NC}     https://${LOCAL_IP}                               "
echo -e "${GRN}║${NC}     https://${SUMMARY_HOSTNAME}.local                      "
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
