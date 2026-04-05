#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# HomePiNAS Dashboard v3.5 — Uninstaller
# Deja el sistema Debian/Raspberry Pi OS limpio.
#
# Uso: sudo bash uninstall.sh
#      sudo bash uninstall.sh --purge-docker   (elimina también Docker y sus datos)
#      sudo bash uninstall.sh --keep-data      (mantiene /opt/homepinas/config)
# ═══════════════════════════════════════════════════════════════════════════

set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

# ─── Colores ────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GRN='\033[0;32m'; BLU='\033[0;34m'
YLW='\033[1;33m'; NC='\033[0m'

info()  { echo -e "${BLU}[INFO]${NC}  $*"; }
ok()    { echo -e "${GRN}[OK]${NC}    $*"; }
warn()  { echo -e "${YLW}[WARN]${NC}  $*"; }

# ─── Opciones ───────────────────────────────────────────────────────────────
PURGE_DOCKER=0
KEEP_DATA=0

for arg in "$@"; do
    case "$arg" in
        --purge-docker) PURGE_DOCKER=1 ;;
        --keep-data)    KEEP_DATA=1    ;;
        --help|-h)
            echo "Uso: sudo bash uninstall.sh [opciones]"
            echo "  --purge-docker   Elimina también Docker, imágenes y volúmenes"
            echo "  --keep-data      Mantiene /opt/homepinas/config (base de datos, .env, certs)"
            exit 0
            ;;
    esac
done

# ─── Root check ─────────────────────────────────────────────────────────────
[ "$(id -u)" -ne 0 ] && { echo "Ejecuta como root: sudo bash uninstall.sh"; exit 1; }

INSTALL_DIR="/opt/homepinas"
SERVICE_NAME="homepinas"

echo -e "${RED}"
echo "  ╔══════════════════════════════════════════════════╗"
echo "  ║   HomePiNAS — Desinstalador                      ║"
echo "  ╚══════════════════════════════════════════════════╝"
echo -e "${NC}"

if [[ $KEEP_DATA -eq 0 ]]; then
    warn "Esto eliminará HomePiNAS Y sus datos de configuración."
else
    warn "Esto eliminará HomePiNAS pero mantendrá /opt/homepinas/config."
fi

if [[ $PURGE_DOCKER -eq 1 ]]; then
    warn "También se eliminarán Docker, todas sus imágenes, contenedores y volúmenes."
fi

echo
read -r -p "¿Continuar? [s/N] " CONFIRM
[[ "$CONFIRM" =~ ^[sS]$ ]] || { echo "Cancelado."; exit 0; }
echo

# ═══════════════════════════════════════════════════════════════════════════
# 1. Detener y eliminar el servicio systemd
# ═══════════════════════════════════════════════════════════════════════════
info "Deteniendo y eliminando servicio systemd..."

systemctl stop  "$SERVICE_NAME" 2>/dev/null && ok "Servicio detenido"   || warn "Servicio no estaba corriendo"
systemctl disable "$SERVICE_NAME" 2>/dev/null && ok "Servicio deshabilitado" || true

if [[ -f "/etc/systemd/system/${SERVICE_NAME}.service" ]]; then
    rm -f "/etc/systemd/system/${SERVICE_NAME}.service"
    systemctl daemon-reload
    ok "Archivo de servicio eliminado"
fi

# ═══════════════════════════════════════════════════════════════════════════
# 2. Eliminar directorio de instalación
# ═══════════════════════════════════════════════════════════════════════════
if [[ -d "$INSTALL_DIR" ]]; then
    if [[ $KEEP_DATA -eq 1 ]]; then
        info "Conservando config — eliminando el resto de ${INSTALL_DIR}..."
        # Guardar config en tmp
        TMP_CONFIG="/tmp/homepinas-config-backup-$$"
        cp -a "${INSTALL_DIR}/config" "$TMP_CONFIG" 2>/dev/null || true
        rm -rf "$INSTALL_DIR"
        mkdir -p "${INSTALL_DIR}/config"
        cp -a "${TMP_CONFIG}/." "${INSTALL_DIR}/config/" 2>/dev/null || true
        rm -rf "$TMP_CONFIG"
        ok "Config preservada en ${INSTALL_DIR}/config"
    else
        info "Eliminando ${INSTALL_DIR}..."
        rm -rf "$INSTALL_DIR"
        ok "${INSTALL_DIR} eliminado"
    fi
fi

# Eliminar backups de instalaciones anteriores
for bak in /opt/homepinas.backup.*; do
    [[ -d "$bak" ]] && rm -rf "$bak" && info "Backup eliminado: $bak"
done

# ═══════════════════════════════════════════════════════════════════════════
# 3. Sudoers
# ═══════════════════════════════════════════════════════════════════════════
if [[ -f /etc/sudoers.d/homepinas ]]; then
    rm -f /etc/sudoers.d/homepinas
    ok "Sudoers eliminado"
fi

# ═══════════════════════════════════════════════════════════════════════════
# 4. Repositorios apt de NodeSource y Docker
# ═══════════════════════════════════════════════════════════════════════════
info "Eliminando repositorios apt de terceros..."

if [[ -f /etc/apt/sources.list.d/nodesource.list ]]; then
    rm -f /etc/apt/sources.list.d/nodesource.list
    rm -f /usr/share/keyrings/nodesource.gpg 2>/dev/null || true
    ok "Repositorio NodeSource eliminado"
fi

if [[ -f /etc/apt/sources.list.d/docker.list ]]; then
    rm -f /etc/apt/sources.list.d/docker.list
    rm -f /usr/share/keyrings/docker.gpg 2>/dev/null || true
    ok "Repositorio Docker eliminado"
fi

# ═══════════════════════════════════════════════════════════════════════════
# 5. Node.js
# ═══════════════════════════════════════════════════════════════════════════
info "Eliminando Node.js..."
apt-get purge -y nodejs npm 2>/dev/null && ok "Node.js eliminado" || warn "Node.js no encontrado o no purgable"
apt-get autoremove -y 2>/dev/null || true

# ═══════════════════════════════════════════════════════════════════════════
# 6. Paquetes instalados por HomePiNAS (opcionales — solo si no se usaban antes)
# ═══════════════════════════════════════════════════════════════════════════
info "Eliminando paquetes de almacenamiento instalados por HomePiNAS..."

PKGS_TO_REMOVE=(
    snapraid
    mergerfs
    smartmontools
    apcupsd
    wireguard-tools
    qrencode
    ntfs-3g exfat-fuse exfatprogs
)

for pkg in "${PKGS_TO_REMOVE[@]}"; do
    if dpkg -l "$pkg" 2>/dev/null | grep -q "^ii"; then
        apt-get purge -y "$pkg" 2>/dev/null && ok "$pkg eliminado" || warn "No se pudo purgar $pkg"
    fi
done

apt-get autoremove -y 2>/dev/null || true

# ═══════════════════════════════════════════════════════════════════════════
# 7. Samba y NFS (deshabilitados por el instalador — purgar si se desea)
# ═══════════════════════════════════════════════════════════════════════════
echo
read -r -p "¿Eliminar también Samba y NFS? [s/N] " REMOVE_SAMBA
if [[ "$REMOVE_SAMBA" =~ ^[sS]$ ]]; then
    for svc in smbd nmbd winbind nfs-server nfs-kernel-server; do
        systemctl stop    "$svc" 2>/dev/null || true
        systemctl disable "$svc" 2>/dev/null || true
    done
    apt-get purge -y samba samba-common-bin samba-common nfs-kernel-server nfs-common 2>/dev/null \
        && ok "Samba y NFS eliminados" || warn "No se pudieron purgar Samba/NFS"
    apt-get autoremove -y 2>/dev/null || true
fi

# ═══════════════════════════════════════════════════════════════════════════
# 8. Docker (solo con --purge-docker)
# ═══════════════════════════════════════════════════════════════════════════
if [[ $PURGE_DOCKER -eq 1 ]]; then
    echo
    warn "Eliminando Docker y TODOS sus datos (contenedores, imágenes, volúmenes)..."
    read -r -p "¿Confirmar eliminación de Docker? [s/N] " CONFIRM_DOCKER
    if [[ "$CONFIRM_DOCKER" =~ ^[sS]$ ]]; then
        # Parar todos los contenedores
        docker stop $(docker ps -aq) 2>/dev/null || true
        # Eliminar todo
        docker system prune -af --volumes 2>/dev/null || true

        for svc in docker docker.socket containerd; do
            systemctl stop    "$svc" 2>/dev/null || true
            systemctl disable "$svc" 2>/dev/null || true
        done

        apt-get purge -y \
            docker-ce docker-ce-cli containerd.io docker-compose-plugin \
            docker.io docker-compose 2>/dev/null || true
        apt-get autoremove -y 2>/dev/null || true

        rm -rf /var/lib/docker /var/lib/containerd
        rm -rf /usr/local/lib/docker
        groupdel docker 2>/dev/null || true

        ok "Docker eliminado completamente"
    else
        info "Docker conservado"
    fi
fi

# ═══════════════════════════════════════════════════════════════════════════
# 9. Directorios de mount points (solo si están vacíos)
# ═══════════════════════════════════════════════════════════════════════════
info "Limpiando mount points de /mnt/ (solo si están vacíos)..."
for dir in /mnt/storage /mnt/storage/.tmp /mnt/storage/.uploads-tmp /mnt/cache /mnt/parity /mnt/disks; do
    if [[ -d "$dir" ]]; then
        # Desmontar si está montado
        mountpoint -q "$dir" 2>/dev/null && umount "$dir" 2>/dev/null || true
        # Borrar solo si vacío
        rmdir "$dir" 2>/dev/null && ok "$dir eliminado" || warn "$dir no está vacío — conservado"
    fi
done

# ═══════════════════════════════════════════════════════════════════════════
# 10. Limpiar apt
# ═══════════════════════════════════════════════════════════════════════════
info "Actualizando listas de paquetes..."
apt-get update -q 2>/dev/null || true

# ═══════════════════════════════════════════════════════════════════════════
# FIN
# ═══════════════════════════════════════════════════════════════════════════
echo
echo -e "${GRN}════════════════════════════════════════════════${NC}"
echo -e "${GRN}  HomePiNAS desinstalado correctamente.         ${NC}"

if [[ $KEEP_DATA -eq 1 ]]; then
    echo -e "${YLW}  Config conservada en: ${INSTALL_DIR}/config    ${NC}"
fi

echo -e "${GRN}════════════════════════════════════════════════${NC}"
echo
echo "  Lo que NO se ha tocado:"
echo "  • Discos de datos (/dev/sd*) — nunca se formatean ni montan"
echo "  • /etc/fstab — no fue modificado por el instalador"
echo "  • Usuarios del sistema"
if [[ $PURGE_DOCKER -eq 0 ]]; then
    echo "  • Docker y sus datos (usa --purge-docker para eliminarlo)"
fi
echo
