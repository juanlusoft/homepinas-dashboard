/**
 * HomePiNAS - Session Management
 * v1.5.6 - Modular Architecture
 *
 * SQLite-backed persistent session storage
 */

const log = require('./logger');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const Database = require('better-sqlite3');

import type { Database as BetterSqlite3Database } from 'better-sqlite3';

const SESSION_DB_PATH = path.join(__dirname, '..', 'config', 'sessions.db');
const SESSION_DURATION = (() => {
  const v = parseInt(process.env.SESSION_DURATION ?? '', 10);
  if (process.env.SESSION_DURATION && isNaN(v)) {
    console.warn(`[session] Invalid SESSION_DURATION env var: "${process.env.SESSION_DURATION}", using default`);
  }
  return isNaN(v) ? 24 * 60 * 60 * 1000 : v;
})();
const SESSION_IDLE_TIMEOUT = (() => {
  const v = parseInt(process.env.SESSION_IDLE_TIMEOUT ?? '', 10);
  if (process.env.SESSION_IDLE_TIMEOUT && isNaN(v)) {
    console.warn(`[session] Invalid SESSION_IDLE_TIMEOUT env var: "${process.env.SESSION_IDLE_TIMEOUT}", using default`);
  }
  return isNaN(v) ? 2 * 60 * 60 * 1000 : v;
})();

let sessionDb: BetterSqlite3Database | null = null;

/**
 * Session data interface (row shape from database)
 */
interface SessionRow {
  session_id: string;
  username: string;
  expires_at: number;
  created_at: number;
  last_activity: number | null;
}

/**
 * Session validation result interface
 */
interface SessionData {
  username: string;
  expiresAt: number;
}

/**
 * CSRF token row from database
 */
interface CsrfTokenRow {
  token: string;
  created_at: number;
}

/**
 * CSRF token result interface
 */
interface CsrfToken {
  token: string;
  createdAt: number;
}

/**
 * Initialize SQLite session database
 */
function initSessionDb(): boolean {
    try {
        const configDir = path.dirname(SESSION_DB_PATH);
        if (!fs.existsSync(configDir)) {
            fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
        }

        sessionDb = new Database(SESSION_DB_PATH);

        // SECURITY: Set restrictive permissions on database file (owner read/write only)
        try {
            fs.chmodSync(SESSION_DB_PATH, 0o600);
        } catch (e) {
            log.warn('Could not set restrictive permissions on session database');
        }

        // sessionDb is guaranteed non-null here after successful new Database()
        const db = sessionDb!;

        db.exec(`
            CREATE TABLE IF NOT EXISTS sessions (
                session_id TEXT PRIMARY KEY,
                username TEXT NOT NULL,
                expires_at INTEGER NOT NULL,
                created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
                last_activity INTEGER DEFAULT (strftime('%s', 'now') * 1000)
            )
        `);

        // Migration: add last_activity column if missing
        try {
            db.exec(`ALTER TABLE sessions ADD COLUMN last_activity INTEGER DEFAULT (strftime('%s', 'now') * 1000)`);
        } catch (e) {
            // Column already exists, ignore
        }

        db.exec(`
            CREATE INDEX IF NOT EXISTS idx_sessions_expires
            ON sessions(expires_at)
        `);

        // CSRF tokens table (persistent across restarts)
        db.exec(`
            CREATE TABLE IF NOT EXISTS csrf_tokens (
                session_id TEXT PRIMARY KEY,
                token TEXT NOT NULL,
                created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
            )
        `);

        log.info('Session database initialized at', SESSION_DB_PATH);
        cleanExpiredSessions();

        return true;
    } catch (e) {
        const error = e as Error;
        log.error('Failed to initialize session database:', error.message);
        return false;
    }
}

/**
 * Create a new session
 */
function createSession(username: string): string | null {
    const sessionId = uuidv4();
    const expiresAt = Date.now() + SESSION_DURATION;

    if (!sessionDb) {
        log.error('Session database not initialized');
        return null;
    }

    try {
        const stmt = sessionDb.prepare(`
            INSERT INTO sessions (session_id, username, expires_at)
            VALUES (?, ?, ?)
        `);
        stmt.run(sessionId, username, expiresAt);
        return sessionId;
    } catch (e) {
        const error = e as Error;
        log.error('Failed to create session:', error.message);
        return null;
    }
}

/**
 * Validate a session (checks absolute expiration and idle timeout)
 */
function validateSession(sessionId: string): SessionData | null {
    if (!sessionId || !sessionDb) return null;

    try {
        const stmt = sessionDb.prepare(`
            SELECT session_id, username, expires_at, last_activity
            FROM sessions
            WHERE session_id = ?
        `);
        const session = stmt.get(sessionId) as SessionRow | undefined;

        if (!session) return null;

        const now = Date.now();

        // Check absolute expiration (24h from creation)
        if (now > session.expires_at) {
            destroySession(sessionId);
            return null;
        }

        // Check idle timeout (2h from last activity)
        const lastActivity = session.last_activity || session.expires_at - SESSION_DURATION;
        if (now - lastActivity > SESSION_IDLE_TIMEOUT) {
            destroySession(sessionId);
            return null;
        }

        // Update last activity timestamp
        try {
            const updateStmt = sessionDb.prepare(`
                UPDATE sessions SET last_activity = ? WHERE session_id = ?
            `);
            updateStmt.run(now, sessionId);
        } catch (e) {
            // Non-critical, continue
        }

        return {
            username: session.username,
            expiresAt: session.expires_at
        };
    } catch (e) {
        const error = e as Error;
        log.error('Failed to validate session:', error.message);
        return null;
    }
}

/**
 * Destroy a session
 */
function destroySession(sessionId: string): void {
    if (!sessionDb) return;

    try {
        const stmt = sessionDb.prepare('DELETE FROM sessions WHERE session_id = ?');
        stmt.run(sessionId);
    } catch (e) {
        const error = e as Error;
        log.error('Failed to destroy session:', error.message);
    }
}

/**
 * Clear all sessions
 */
function clearAllSessions(): void {
    if (!sessionDb) return;

    try {
        sessionDb.exec('DELETE FROM sessions');
    } catch (e) {
        const error = e as Error;
        log.error('Failed to clear sessions:', error.message);
    }
}

/**
 * Clean expired sessions (absolute expiration and idle timeout)
 */
function cleanExpiredSessions(): void {
    if (!sessionDb) return;

    try {
        const now = Date.now();
        const idleThreshold = now - SESSION_IDLE_TIMEOUT;

        // Delete sessions that are expired OR idle too long
        const stmt = sessionDb.prepare(`
            DELETE FROM sessions
            WHERE expires_at < ?
            OR (last_activity IS NOT NULL AND last_activity < ?)
        `);
        const result = stmt.run(now, idleThreshold) as { changes: number };
        if (result.changes > 0) {
            log.info(`Cleaned ${result.changes} expired/idle sessions`);
        }
    } catch (e) {
        const error = e as Error;
        log.error('Failed to clean expired sessions:', error.message);
    }
}

/**
 * Start periodic cleanup (sessions + CSRF tokens)
 */
function startSessionCleanup(): void {
    setInterval(() => {
        cleanExpiredSessions();
        cleanExpiredCsrfTokens();
    }, 60 * 60 * 1000); // Clean every hour
}

// ============ CSRF Token Persistence ============

const CSRF_TOKEN_DURATION = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Store CSRF token in database
 */
function storeCsrfToken(sessionId: string, token: string): boolean {
    if (!sessionDb || !sessionId || !token) return false;

    try {
        const stmt = sessionDb.prepare(`
            INSERT OR REPLACE INTO csrf_tokens (session_id, token, created_at)
            VALUES (?, ?, ?)
        `);
        stmt.run(sessionId, token, Date.now());
        return true;
    } catch (e) {
        const error = e as Error;
        log.error('Failed to store CSRF token:', error.message);
        return false;
    }
}

/**
 * Get CSRF token from database
 */
function getCsrfTokenFromDb(sessionId: string): CsrfToken | null {
    if (!sessionDb || !sessionId) return null;

    try {
        const stmt = sessionDb.prepare(`
            SELECT token, created_at FROM csrf_tokens WHERE session_id = ?
        `);
        const row = stmt.get(sessionId) as CsrfTokenRow | undefined;

        if (!row) return null;

        // Check expiration
        if (Date.now() - row.created_at > CSRF_TOKEN_DURATION) {
            deleteCsrfToken(sessionId);
            return null;
        }

        return { token: row.token, createdAt: row.created_at };
    } catch (e) {
        const error = e as Error;
        log.error('Failed to get CSRF token:', error.message);
        return null;
    }
}

/**
 * Delete CSRF token from database
 */
function deleteCsrfToken(sessionId: string): void {
    if (!sessionDb || !sessionId) return;

    try {
        const stmt = sessionDb.prepare('DELETE FROM csrf_tokens WHERE session_id = ?');
        stmt.run(sessionId);
    } catch (e) {
        const error = e as Error;
        log.error('Failed to delete CSRF token:', error.message);
    }
}

/**
 * Clean expired CSRF tokens
 */
function cleanExpiredCsrfTokens(): void {
    if (!sessionDb) return;

    try {
        const threshold = Date.now() - CSRF_TOKEN_DURATION;
        const stmt = sessionDb.prepare('DELETE FROM csrf_tokens WHERE created_at < ?');
        const result = stmt.run(threshold) as { changes: number };
        if (result.changes > 0) {
            log.info(`Cleaned ${result.changes} expired CSRF tokens`);
        }
    } catch (e) {
        const error = e as Error;
        log.error('Failed to clean CSRF tokens:', error.message);
    }
}

module.exports = {
    initSessionDb,
    createSession,
    validateSession,
    destroySession,
    clearAllSessions,
    cleanExpiredSessions,
    startSessionCleanup,
    SESSION_DURATION,
    SESSION_IDLE_TIMEOUT,
    // CSRF token persistence
    storeCsrfToken,
    getCsrfTokenFromDb,
    deleteCsrfToken,
    cleanExpiredCsrfTokens,
    CSRF_TOKEN_DURATION
};
