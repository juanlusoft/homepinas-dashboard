/**
 * HomePiNAS v2 - Role-Based Access Control (RBAC) Middleware
 * Security audit 2026-02-04
 */

const { getData } = require('../utils/data');

/**
 * Permission sets for each role
 */
const PERMISSIONS = {
    admin: ['read', 'write', 'delete', 'admin'],
    user: ['read', 'write', 'delete'],
    readonly: ['read']
};

/**
 * Get user's role from data
 */
function getUserRole(username) {
    const data = getData();
    
    // Primary admin user (data.user) is always admin
    if (data.user && data.user.username === username) {
        return 'admin';
    }
    
    // Multi-user: look up role
    const users = data.users || [];
    const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());
    return user?.role || 'readonly';
}

/**
 * Get user's permissions based on role
 */
function getUserPermissions(username) {
    const role = getUserRole(username);
    return PERMISSIONS[role] || PERMISSIONS.readonly;
}

/**
 * Middleware factory: require specific permission
 * Usage: router.post('/delete', requirePermission('delete'), handler)
 */
function requirePermission(permission) {
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
function requireAdmin(req, res, next) {
    return requirePermission('admin')(req, res, next);
}

/**
 * Check if user has permission (non-middleware helper)
 */
function hasPermission(username, permission) {
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
