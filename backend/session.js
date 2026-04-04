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

const SESSION_DB_PATH = path.join(__dirname, '..', 'config', 'sessions.db');
const SESSION_DURATION = 24 * 60 * 60 * 1000; // 24 hours absolute expiration
const SESSION_IDLE_TIMEOUT = 2 * 60 * 60 * 1000; // 2 hours idle timeout

let sessionDb = null;

/**
 * Initialize SQLite session database
 */
function initSessionDb() {
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

        sessionDb.exec(`
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
            sessionDb.exec(`ALTER TABLE sessions ADD COLUMN last_activity INTEGER DEFAULT (strftime('%s', 'now') * 1000)`);
        } catch (e) {
            // Column already exists, ignore
        }

        sessionDb.exec(`
            CREATE INDEX IF NOT EXISTS idx_sessions_expires
            ON sessions(expires_at)
        `);

        // CSRF tokens table (persistent across restarts)
        sessionDb.exec(`
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
        log.error('Failed to initialize session database:', e.message);
        return false;
    }
}

/**
 * Create a new session
 */
function createSession(username) {
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
        log.error('Failed to create session:', e.message);
        return null;
    }
}

/**
 * Validate a session (checks absolute expiration and idle timeout)
 */
function validateSession(sessionId) {
    if (!sessionId || !sessionDb) return null;

    try {
        const stmt = sessionDb.prepare(`
            SELECT session_id, username, expires_at, last_activity
            FROM sessions
            WHERE session_id = ?
        `);
        const session = stmt.get(sessionId);

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
        log.error('Failed to validate session:', e.message);
        return null;
    }
}

/**
 * Destroy a session
 */
function destroySession(sessionId) {
    if (!sessionDb) return;

    try {
        const stmt = sessionDb.prepare('DELETE FROM sessions WHERE session_id = ?');
        stmt.run(sessionId);
    } catch (e) {
        log.error('Failed to destroy session:', e.message);
    }
}

/**
 * Clear all sessions
 */
function clearAllSessions() {
    if (!sessionDb) return;

    try {
        sessionDb.exec('DELETE FROM sessions');
    } catch (e) {
        log.error('Failed to clear sessions:', e.message);
    }
}

/**
 * Clean expired sessions (absolute expiration and idle timeout)
 */
function cleanExpiredSessions() {
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
        const result = stmt.run(now, idleThreshold);
        if (result.changes > 0) {
            log.info(`Cleaned ${result.changes} expired/idle sessions`);
        }
    } catch (e) {
        log.error('Failed to clean expired sessions:', e.message);
    }
}

/**
 * Start periodic cleanup (sessions + CSRF tokens)
 */
function startSessionCleanup() {
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
function storeCsrfToken(sessionId, token) {
    if (!sessionDb || !sessionId || !token) return false;

    try {
        const stmt = sessionDb.prepare(`
            INSERT OR REPLACE INTO csrf_tokens (session_id, token, created_at)
            VALUES (?, ?, ?)
        `);
        stmt.run(sessionId, token, Date.now());
        return true;
    } catch (e) {
        log.error('Failed to store CSRF token:', e.message);
        return false;
    }
}

/**
 * Get CSRF token from database
 */
function getCsrfTokenFromDb(sessionId) {
    if (!sessionDb || !sessionId) return null;

    try {
        const stmt = sessionDb.prepare(`
            SELECT token, created_at FROM csrf_tokens WHERE session_id = ?
        `);
        const row = stmt.get(sessionId);
        
        if (!row) return null;
        
        // Check expiration
        if (Date.now() - row.created_at > CSRF_TOKEN_DURATION) {
            deleteCsrfToken(sessionId);
            return null;
        }
        
        return { token: row.token, createdAt: row.created_at };
    } catch (e) {
        log.error('Failed to get CSRF token:', e.message);
        return null;
    }
}

/**
 * Delete CSRF token from database
 */
function deleteCsrfToken(sessionId) {
    if (!sessionDb || !sessionId) return;

    try {
        const stmt = sessionDb.prepare('DELETE FROM csrf_tokens WHERE session_id = ?');
        stmt.run(sessionId);
    } catch (e) {
        log.error('Failed to delete CSRF token:', e.message);
    }
}

/**
 * Clean expired CSRF tokens
 */
function cleanExpiredCsrfTokens() {
    if (!sessionDb) return;

    try {
        const threshold = Date.now() - CSRF_TOKEN_DURATION;
        const stmt = sessionDb.prepare('DELETE FROM csrf_tokens WHERE created_at < ?');
        const result = stmt.run(threshold);
        if (result.changes > 0) {
            log.info(`Cleaned ${result.changes} expired CSRF tokens`);
        }
    } catch (e) {
        log.error('Failed to clean CSRF tokens:', e.message);
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
