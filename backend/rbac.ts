/**
 * HomePiNAS v2 - Role-Based Access Control (RBAC) Middleware
 * Security audit 2026-02-04
 */

import type { RequestHandler } from 'express-serve-static-core';

const { getData } = require('./data');

type Role = 'admin' | 'user' | 'readonly';

interface UserRecord {
    username: string;
    role?: Role;
}

/**
 * Permission sets for each role
 */
const PERMISSIONS: Record<Role, string[]> = {
    admin: ['read', 'write', 'delete', 'admin'],
    user: ['read', 'write', 'delete'],
    readonly: ['read']
};

/**
 * Get user's role from data
 */
function getUserRole(username: string): Role {
    const data = getData();

    // Primary admin user (data.user) is always admin
    if (data.user && data.user.username === username) {
        return 'admin';
    }

    // Multi-user: look up role
    const users: UserRecord[] = data.users || [];
    const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());
    return user?.role || 'readonly';
}

/**
 * Get user's permissions based on role
 */
function getUserPermissions(username: string): string[] {
    const role = getUserRole(username);
    return PERMISSIONS[role] || PERMISSIONS.readonly;
}

/**
 * Middleware factory: require specific permission
 * Usage: router.post('/delete', requirePermission('delete'), handler)
 */
function requirePermission(permission: string): RequestHandler {
    return (req, res, next) => {
        if (!req.user || !req.user.username) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        const role = getUserRole(req.user.username);
        const perms = PERMISSIONS[role] || [];

        if (!perms.includes(permission)) {
            return res.status(403).json({
                error: `Permission denied. Required: ${permission}, Your role: ${role}`
            });
        }

        // Attach role and permissions to request for use in handlers
        req.user.role = role;
        req.user.permissions = perms;
        next();
    };
}

/**
 * Middleware: require admin role
 */
const requireAdmin: RequestHandler = (req, res, next) =>
    requirePermission('admin')(req, res, next);

/**
 * Check if user has permission (non-middleware helper)
 */
function hasPermission(username: string, permission: string): boolean {
    const perms = getUserPermissions(username);
    return perms.includes(permission);
}

module.exports = {
    PERMISSIONS,
    getUserRole,
    getUserPermissions,
    requirePermission,
    requireAdmin,
    hasPermission
};
