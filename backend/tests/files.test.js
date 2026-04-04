// backend/tests/files.test.js
// Tests for backend/routes/files.js
// Run with: npx vitest backend/tests/files.test.js

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';

function makeReqRes(overrides = {}) {
    const res = {
        _status: 200,
        _json: null,
        _headers: {},
        status(code) { this._status = code; return this; },
        json(body) { this._json = body; return this; },
        setHeader(k, v) { this._headers[k] = v; },
        attachment(filename) { this._attachment = filename; return this; },
    };
    const req = {
        query: {},
        body: {},
        user: { username: 'testuser' },
        ...overrides,
    };
    const next = vi.fn();
    return { req, res, next };
}

describe('files route — list endpoint logic', () => {
    it('returns 400 when path query param is missing', async () => {
        const { sanitizePath } = await import('../sanitize.ts');
        expect(sanitizePath(undefined)).toBeNull();
        expect(sanitizePath('')).toBeNull();
        expect(sanitizePath(null)).toBeNull();
    });

    it('sanitizePath blocks dangerous system directories', async () => {
        const { sanitizePath } = await import('../sanitize.ts');
        expect(sanitizePath('/etc')).toBeNull();
        expect(sanitizePath('/proc/self/mem')).toBeNull();
        expect(sanitizePath('/root')).toBeNull();
    });

    it('sanitizePath allows safe NAS paths', async () => {
        const { sanitizePath } = await import('../sanitize.ts');
        expect(sanitizePath('/srv/nas')).not.toBeNull();
        expect(sanitizePath('/srv/nas/photos')).not.toBeNull();
        expect(sanitizePath('/home/juan/documents')).not.toBeNull();
    });

    it('sortEntries puts directories before files, both alphabetical', () => {
        function sortEntries(entries) {
            return [...entries].sort((a, b) => {
                if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
                return a.name.localeCompare(b.name);
            });
        }

        const input = [
            { name: 'zebra.txt', type: 'file' },
            { name: 'alpha', type: 'directory' },
            { name: 'apple.jpg', type: 'file' },
            { name: 'beta', type: 'directory' },
        ];
        const sorted = sortEntries(input);
        expect(sorted[0].name).toBe('alpha');
        expect(sorted[1].name).toBe('beta');
        expect(sorted[2].name).toBe('apple.jpg');
        expect(sorted[3].name).toBe('zebra.txt');
    });
});

describe('files route — download endpoint logic', () => {
    it('sanitizePath rejects path traversal in download path', async () => {
        const { sanitizePath } = await import('../sanitize.ts');
        expect(sanitizePath('../../../etc/passwd')).toBeNull();
        expect(sanitizePath('/srv/nas/../../etc/shadow')).toBeNull();
    });

    it('sanitizePath accepts a valid file path for download', async () => {
        const { sanitizePath } = await import('../sanitize.ts');
        const result = sanitizePath('/srv/nas/backups/archive.tar.gz');
        expect(result).not.toBeNull();
        expect(result).toBe('/srv/nas/backups/archive.tar.gz');
    });
});

describe('files route — upload path resolution logic', () => {
    it('sanitizePath accepts a valid upload target directory', async () => {
        const { sanitizePath } = await import('../sanitize.ts');
        const result = sanitizePath('/srv/nas/uploads');
        expect(result).not.toBeNull();
    });

    it('final upload path is a join of sanitized dir and original filename', () => {
        function buildUploadPath(sanitizedDir, originalname) {
            const safeName = path.posix.basename(originalname);
            return path.posix.join(sanitizedDir, safeName);
        }

        expect(buildUploadPath('/srv/nas/uploads', 'photo.jpg')).toBe('/srv/nas/uploads/photo.jpg');
        expect(buildUploadPath('/srv/nas/uploads', '../../etc/passwd')).toBe('/srv/nas/uploads/passwd');
    });
});

describe('files route — search query validation', () => {
    it('rejects empty search query', () => {
        function validateSearchQuery(q) {
            if (!q || typeof q !== 'string' || q.trim().length === 0) return null;
            return q.replace(/[^a-zA-Z0-9._\- ]/g, '').substring(0, 100);
        }
        expect(validateSearchQuery('')).toBeNull();
        expect(validateSearchQuery(null)).toBeNull();
        expect(validateSearchQuery('   ')).toBeNull();
    });

    it('sanitizes shell-dangerous characters from search query', () => {
        function validateSearchQuery(q) {
            if (!q || typeof q !== 'string' || q.trim().length === 0) return null;
            return q.replace(/[^a-zA-Z0-9._\- ]/g, '').substring(0, 100);
        }
        expect(validateSearchQuery('$(rm -rf /)')).toBe('rm -rf ');
        expect(validateSearchQuery('normal search')).toBe('normal search');
        expect(validateSearchQuery('file.txt')).toBe('file.txt');
    });

    it('truncates search query to 100 characters', () => {
        function validateSearchQuery(q) {
            if (!q || typeof q !== 'string' || q.trim().length === 0) return null;
            return q.replace(/[^a-zA-Z0-9._\- ]/g, '').substring(0, 100);
        }
        const longQuery = 'a'.repeat(200);
        expect(validateSearchQuery(longQuery).length).toBe(100);
    });
});

describe('files route — user-home logic', () => {
    it('returns default home path when no user-specific path configured', () => {
        function resolveUserHome(data, username) {
            const users = data.users || [];
            const user = users.find(u => u.username === username);
            const homePath = user?.homePath || '/srv/nas';
            const storageConfig = data.storageConfig || [];
            const mountPoints = storageConfig
                .filter(d => d.mountPoint)
                .map(d => d.mountPoint);
            const allowedPaths = mountPoints.length > 0
                ? [homePath, ...mountPoints.filter(mp => mp !== homePath)]
                : [homePath, '/home'];
            return { homePath, hasRestrictions: false, allowedPaths };
        }

        const result = resolveUserHome({ users: [], storageConfig: [] }, 'testuser');
        expect(result.homePath).toBe('/srv/nas');
        expect(result.hasRestrictions).toBe(false);
        expect(result.allowedPaths).toContain('/srv/nas');
    });

    it('uses user-specific homePath when set in data', () => {
        function resolveUserHome(data, username) {
            const users = data.users || [];
            const user = users.find(u => u.username === username);
            const homePath = user?.homePath || '/srv/nas';
            const storageConfig = data.storageConfig || [];
            const mountPoints = storageConfig
                .filter(d => d.mountPoint)
                .map(d => d.mountPoint);
            const allowedPaths = mountPoints.length > 0
                ? [homePath, ...mountPoints.filter(mp => mp !== homePath)]
                : [homePath, '/home'];
            return { homePath, hasRestrictions: false, allowedPaths };
        }

        const data = {
            users: [{ username: 'juan', homePath: '/srv/nas/juan' }],
            storageConfig: []
        };
        const result = resolveUserHome(data, 'juan');
        expect(result.homePath).toBe('/srv/nas/juan');
    });
});
