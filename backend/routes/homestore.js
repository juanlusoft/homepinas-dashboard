'use strict';
const router = require('express').Router();
const path = require('path');
const fs = require('fs').promises;
const { safeExec } = require('../security');
const { requireAuth } = require('../auth');
const { requirePermission } = require('../rbac');
const { validateComposeContent, sanitizeComposeName } = require('../sanitize');
const log = require('../logger');

const COMPOSE_DIR = path.join(__dirname, '..', '..', 'config', 'compose');

const CATALOG = [
    { id: 'jellyfin', name: 'Jellyfin', description: 'Media server for your personal media collection', icon: '🎬', category: 'media', arch: ['arm64', 'amd64', 'armhf'], composeContent: `services:\n  jellyfin:\n    image: jellyfin/jellyfin:latest\n    container_name: jellyfin\n    restart: unless-stopped\n    network_mode: host\n    volumes:\n      - ./jellyfin/config:/config\n      - ./jellyfin/cache:/cache\n      - /srv/nas/media:/media` },
    { id: 'nextcloud', name: 'Nextcloud', description: 'Self-hosted cloud storage and collaboration', icon: '☁️', category: 'storage', arch: ['arm64', 'amd64'], composeContent: `services:\n  nextcloud:\n    image: nextcloud:latest\n    container_name: nextcloud\n    restart: unless-stopped\n    ports:\n      - "8080:80"\n    volumes:\n      - ./nextcloud/data:/var/www/html\n    environment:\n      - SQLITE_DATABASE=nextcloud` },
    { id: 'pihole', name: 'Pi-hole', description: 'Network-wide ad blocking DNS server', icon: '🕳️', category: 'network', arch: ['arm64', 'amd64', 'armhf'], composeContent: `services:\n  pihole:\n    image: pihole/pihole:latest\n    container_name: pihole\n    restart: unless-stopped\n    network_mode: host\n    environment:\n      - TZ=UTC\n      - WEBPASSWORD=changeme\n    volumes:\n      - ./pihole/etc-pihole:/etc/pihole\n      - ./pihole/etc-dnsmasq.d:/etc/dnsmasq.d` },
    { id: 'homeassistant', name: 'Home Assistant', description: 'Open source home automation platform', icon: '🏠', category: 'smart-home', arch: ['arm64', 'amd64', 'armhf'], composeContent: `services:\n  homeassistant:\n    image: ghcr.io/home-assistant/home-assistant:stable\n    container_name: homeassistant\n    restart: unless-stopped\n    network_mode: host\n    privileged: true\n    volumes:\n      - ./homeassistant/config:/config\n    environment:\n      - TZ=UTC` },
    { id: 'portainer', name: 'Portainer', description: 'Docker management UI', icon: '🐳', category: 'management', arch: ['arm64', 'amd64', 'armhf'], composeContent: `services:\n  portainer:\n    image: portainer/portainer-ce:latest\n    container_name: portainer\n    restart: unless-stopped\n    ports:\n      - "9000:9000"\n      - "9443:9443"\n    volumes:\n      - /var/run/docker.sock:/var/run/docker.sock\n      - ./portainer/data:/data` },
    { id: 'grafana', name: 'Grafana', description: 'Analytics and monitoring dashboards', icon: '📈', category: 'monitoring', arch: ['arm64', 'amd64', 'armhf'], composeContent: `services:\n  grafana:\n    image: grafana/grafana:latest\n    container_name: grafana\n    restart: unless-stopped\n    ports:\n      - "3000:3000"\n    volumes:\n      - ./grafana/data:/var/lib/grafana\n    environment:\n      - GF_SECURITY_ADMIN_PASSWORD=changeme` },
    { id: 'uptime-kuma', name: 'Uptime Kuma', description: 'Self-hosted monitoring tool', icon: '📡', category: 'monitoring', arch: ['arm64', 'amd64', 'armhf'], composeContent: `services:\n  uptime-kuma:\n    image: louislam/uptime-kuma:latest\n    container_name: uptime-kuma\n    restart: unless-stopped\n    ports:\n      - "3001:3001"\n    volumes:\n      - ./uptime-kuma/data:/app/data` },
    { id: 'vaultwarden', name: 'Vaultwarden', description: 'Unofficial Bitwarden compatible server', icon: '🔐', category: 'security', arch: ['arm64', 'amd64', 'armhf'], composeContent: `services:\n  vaultwarden:\n    image: vaultwarden/server:latest\n    container_name: vaultwarden\n    restart: unless-stopped\n    ports:\n      - "8181:80"\n    volumes:\n      - ./vaultwarden/data:/data\n    environment:\n      - WEBSOCKET_ENABLED=true` },
    { id: 'immich', name: 'Immich', description: 'High performance self-hosted photo and video backup', icon: '📷', category: 'media', arch: ['arm64', 'amd64'], composeContent: `services:\n  immich-server:\n    image: ghcr.io/immich-app/immich-server:release\n    container_name: immich_server\n    restart: unless-stopped\n    ports:\n      - "2283:3001"\n    volumes:\n      - ./immich/upload:/usr/src/app/upload\n    environment:\n      - DB_PASSWORD=postgres\n      - DB_USERNAME=postgres\n      - DB_DATABASE_NAME=immich\n      - REDIS_HOSTNAME=immich_redis\n  immich-redis:\n    container_name: immich_redis\n    image: redis:6.2-alpine\n    restart: unless-stopped` },
    { id: 'paperless-ngx', name: 'Paperless-ngx', description: 'Document management system', icon: '📄', category: 'productivity', arch: ['arm64', 'amd64'], composeContent: `services:\n  paperless-ngx:\n    image: ghcr.io/paperless-ngx/paperless-ngx:latest\n    container_name: paperless-ngx\n    restart: unless-stopped\n    ports:\n      - "8000:8000"\n    volumes:\n      - ./paperless/data:/usr/src/paperless/data\n      - ./paperless/media:/usr/src/paperless/media\n      - ./paperless/export:/usr/src/paperless/export\n      - ./paperless/consume:/usr/src/paperless/consume\n    environment:\n      - PAPERLESS_REDIS=redis://broker:6379\n  broker:\n    image: redis:7\n    restart: unless-stopped` },
    { id: 'freshrss', name: 'FreshRSS', description: 'Self-hosted RSS feed aggregator', icon: '📰', category: 'productivity', arch: ['arm64', 'amd64', 'armhf'], composeContent: `services:\n  freshrss:\n    image: freshrss/freshrss:latest\n    container_name: freshrss\n    restart: unless-stopped\n    ports:\n      - "8060:80"\n    volumes:\n      - ./freshrss/data:/var/www/FreshRSS/data\n      - ./freshrss/extensions:/var/www/FreshRSS/extensions\n    environment:\n      - TZ=UTC` },
    { id: 'gitea', name: 'Gitea', description: 'Lightweight self-hosted Git service', icon: '🐦', category: 'development', arch: ['arm64', 'amd64', 'armhf'], composeContent: `services:\n  gitea:\n    image: gitea/gitea:latest\n    container_name: gitea\n    restart: unless-stopped\n    ports:\n      - "3030:3000"\n      - "2222:22"\n    volumes:\n      - ./gitea/data:/data\n    environment:\n      - USER_UID=1000\n      - USER_GID=1000` },
    { id: 'miniflux', name: 'Miniflux', description: 'Minimalist and opinionated feed reader', icon: '⚡', category: 'productivity', arch: ['arm64', 'amd64'], composeContent: `services:\n  miniflux:\n    image: miniflux/miniflux:latest\n    container_name: miniflux\n    restart: unless-stopped\n    ports:\n      - "8070:8080"\n    environment:\n      - DATABASE_URL=postgres://miniflux:secret@db/miniflux?sslmode=disable\n      - RUN_MIGRATIONS=1\n      - CREATE_ADMIN=1\n      - ADMIN_USERNAME=admin\n      - ADMIN_PASSWORD=changeme\n  db:\n    image: postgres:15\n    restart: unless-stopped\n    environment:\n      - POSTGRES_USER=miniflux\n      - POSTGRES_PASSWORD=secret\n      - POSTGRES_DB=miniflux\n    volumes:\n      - ./miniflux/db:/var/lib/postgresql/data` },
    { id: 'homer', name: 'Homer', description: 'Static application dashboard', icon: '🗺️', category: 'dashboard', arch: ['arm64', 'amd64', 'armhf'], composeContent: `services:\n  homer:\n    image: b4bz/homer:latest\n    container_name: homer\n    restart: unless-stopped\n    ports:\n      - "8090:8080"\n    volumes:\n      - ./homer/assets:/www/assets\n    user: "1000:1000"` },
    { id: 'dashy', name: 'Dashy', description: 'Feature-rich home lab dashboard', icon: '🖥️', category: 'dashboard', arch: ['arm64', 'amd64'], composeContent: `services:\n  dashy:\n    image: lissy93/dashy:latest\n    container_name: dashy\n    restart: unless-stopped\n    ports:\n      - "4000:8080"\n    volumes:\n      - ./dashy/config.yml:/app/user-data/conf.yml` }
];

async function isInstalled(appId) {
    try { await fs.access(path.join(COMPOSE_DIR, `${appId}.yml`)); return true; } catch { return false; }
}

async function isRunning(appId) {
    try {
        const filePath = path.join(COMPOSE_DIR, `${appId}.yml`);
        const { stdout } = await safeExec('docker', ['compose', '-f', filePath, 'ps', '--format', 'json'], { timeout: 8000 });
        const lines = stdout.trim().split('\n').filter(Boolean);
        if (lines.length === 0) return false;
        return lines.some(line => { try { return (JSON.parse(line).State || '').toLowerCase() === 'running'; } catch { return false; } });
    } catch { return false; }
}

router.get('/', requireAuth, async (req, res) => {
    try {
        await fs.mkdir(COMPOSE_DIR, { recursive: true });
        const apps = await Promise.all(CATALOG.map(async app => {
            const installed = await isInstalled(app.id);
            const running = installed ? await isRunning(app.id) : false;
            return { ...app, installed, running };
        }));
        res.json({ apps });
    } catch (err) {
        log.error('[homestore] GET failed:', err);
        res.status(500).json({ error: 'Failed to load app catalog' });
    }
});

router.post('/install', requireAuth, requirePermission('write'), async (req, res) => {
    try {
        const { appId } = req.body || {};
        if (!appId || typeof appId !== 'string') return res.status(400).json({ error: 'appId is required' });
        const safeName = sanitizeComposeName(appId);
        if (!safeName) return res.status(400).json({ error: 'Invalid appId format' });
        const app = CATALOG.find(a => a.id === safeName);
        if (!app) return res.status(404).json({ error: `App '${safeName}' not found in catalog` });
        const validation = validateComposeContent(app.composeContent);
        if (!validation.valid) { log.error(`[homestore] Catalog compose content invalid for ${safeName}: ${validation.error}`); return res.status(500).json({ error: 'Catalog content error' }); }
        await fs.mkdir(COMPOSE_DIR, { recursive: true });
        const composePath = path.join(COMPOSE_DIR, `${safeName}.yml`);
        await fs.writeFile(composePath, app.composeContent, { encoding: 'utf8', mode: 0o600 });
        try {
            await safeExec('docker', ['compose', '-f', composePath, 'up', '-d'], { timeout: 120000 });
        } catch (err) {
            log.error(`[homestore] docker compose up failed for ${safeName}:`, err.message);
            return res.status(500).json({ error: `docker compose up failed: ${err.message}` });
        }
        log.info(`[homestore] Installed ${safeName}`);
        res.json({ success: true });
    } catch (err) {
        log.error('[homestore] POST /install failed:', err);
        res.status(500).json({ error: 'Failed to install app' });
    }
});

router.post('/uninstall', requireAuth, requirePermission('write'), async (req, res) => {
    try {
        const { appId } = req.body || {};
        if (!appId || typeof appId !== 'string') return res.status(400).json({ error: 'appId is required' });
        const safeName = sanitizeComposeName(appId);
        if (!safeName) return res.status(400).json({ error: 'Invalid appId format' });
        const composePath = path.join(COMPOSE_DIR, `${safeName}.yml`);
        const installed = await isInstalled(safeName);
        if (!installed) return res.status(404).json({ error: `App '${safeName}' is not installed` });
        try {
            await safeExec('docker', ['compose', '-f', composePath, 'down'], { timeout: 60000 });
        } catch (err) {
            log.warn(`[homestore] docker compose down failed for ${safeName} (continuing removal): ${err.message}`);
        }
        await fs.unlink(composePath);
        log.info(`[homestore] Uninstalled ${safeName}`);
        res.json({ success: true });
    } catch (err) {
        log.error('[homestore] POST /uninstall failed:', err);
        res.status(500).json({ error: 'Failed to uninstall app' });
    }
});

router.CATALOG = CATALOG;
module.exports = router;
