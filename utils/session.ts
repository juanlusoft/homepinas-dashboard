'use strict';

/**
 * HomePiNAS - CSRF Session Utilities
 * Stub module: provides CSRF token storage functions used by csrf.ts.
 * In v3.5, CSRF tokens are stored in-memory.
 */

export const CSRF_TOKEN_DURATION = 4 * 60 * 60 * 1000; // 4 hours

const csrfStore = new Map<string, { token: string; createdAt: number }>();

export function storeCsrfToken(sessionId: string, token: string): void {
    csrfStore.set(sessionId, { token, createdAt: Date.now() });
}

export function getCsrfTokenFromDb(sessionId: string): { token: string; createdAt: number } | null {
    return csrfStore.get(sessionId) ?? null;
}

export function deleteCsrfToken(sessionId: string): void {
    csrfStore.delete(sessionId);
}

export function cleanExpiredCsrfTokens(): void {
    const now = Date.now();
    for (const [id, entry] of csrfStore) {
        if (now - entry.createdAt > CSRF_TOKEN_DURATION) {
            csrfStore.delete(id);
        }
    }
}
