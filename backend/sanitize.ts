/**
 * HomePiNAS - Input Sanitization Utilities
 * v1.6.0 - Security Hardening
 *
 * Strict security functions to sanitize and validate all user inputs
 * CRITICAL: All user input MUST pass through these functions before use
 */

const path = require('path');
const fs = require('fs');

interface ComposeValidationResult {
    valid: boolean;
    error?: string;
}

interface ValidatedDisk {
    id: string;
    role: string;
    format: boolean;
}

function toPosixPath(input: unknown): string {
    return String(input).replace(/\\/g, '/');
}

function isWithinBase(targetPath: string, basePath: string): boolean {
    return targetPath === basePath || targetPath.startsWith(basePath + '/');
}

// ============================================================================
// USERNAME SANITIZATION
// ============================================================================

function sanitizeUsername(username: unknown): string | null {
    if (!username || typeof username !== 'string') return null;
    const sanitized = username.replace(/[^a-zA-Z0-9_-]/g, '');
    if (sanitized.length < 3 || sanitized.length > 32) return null;
    if (!/^[a-zA-Z]/.test(sanitized)) return null;
    const reserved = ['root', 'daemon', 'bin', 'sys', 'nobody', 'www-data'];
    if (reserved.includes(sanitized.toLowerCase())) return null;
    return sanitized;
}

function validateUsername(username: unknown): boolean {
    return sanitizeUsername(username) !== null;
}

function validatePassword(password: unknown): boolean {
    if (!password || typeof password !== 'string') return false;
    if (password.length < 6 || password.length > 128) return false;
    return true;
}

// ============================================================================
// STRING SANITIZATION
// ============================================================================

function sanitizeString(str: unknown): string {
    if (!str || typeof str !== 'string') return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;')
        .substring(0, 1000);
}

// ============================================================================
// DISK AND PATH SANITIZATION
// ============================================================================

function sanitizeDiskId(diskId: unknown): string | null {
    if (!diskId || typeof diskId !== 'string') return null;
    const id = diskId.replace(/^\/dev\//, '');
    const validPatterns = [
        /^sd[a-z]$/,
        /^sd[a-z][1-9][0-9]?$/,
        /^nvme[0-9]n[0-9]$/,
        /^nvme[0-9]n[0-9]p[0-9]+$/,
        /^hd[a-z]$/,
        /^vd[a-z]$/,
        /^xvd[a-z]$/,
        /^mmcblk[0-9]$/,
        /^mmcblk[0-9]p[0-9]+$/
    ];
    for (const pattern of validPatterns) {
        if (pattern.test(id)) return id;
    }
    return null;
}

function sanitizeDiskPath(diskPath: unknown): string | null {
    if (!diskPath || typeof diskPath !== 'string') return null;
    if (!diskPath.startsWith('/dev/')) return null;
    const id = sanitizeDiskId(diskPath);
    if (!id) return null;
    return `/dev/${id}`;
}

function sanitizePathWithinBase(inputPath: string, baseDir: string): string | null {
    if (!inputPath || typeof inputPath !== 'string') return null;
    if (!baseDir || typeof baseDir !== 'string') return null;

    const normalizedBase = path.posix.normalize(toPosixPath(baseDir));
    if (!normalizedBase.startsWith('/') ) return null;

    let sanitized = toPosixPath(inputPath.replace(/\0/g, ''));
    sanitized = sanitized.replace(/^\/+/, '');
    const normalizedInput = path.posix.normalize(sanitized);
    if (normalizedInput === '..' || normalizedInput.startsWith('../')) return null;

    const resolvedPath = path.posix.resolve(normalizedBase, normalizedInput || '.');
    if (!isWithinBase(resolvedPath, normalizedBase)) return null;

    // Resolve symlinks when possible for additional traversal safety.
    try {
        const realBase = toPosixPath(fs.realpathSync(baseDir));
        try {
            const realResolved = toPosixPath(fs.realpathSync(resolvedPath));
            return isWithinBase(realResolved, realBase) ? realResolved : null;
        } catch (e) {
            const parentDir = path.posix.dirname(resolvedPath);
            try {
                const realParent = toPosixPath(fs.realpathSync(parentDir));
                if (!isWithinBase(realParent, realBase)) return null;
            } catch (e2) {
                // Parent may not exist yet; containment already checked via resolve.
            }
            return resolvedPath;
        }
    } catch (e) {
        return resolvedPath;
    }
}

function sanitizePath(inputPath: unknown): string | null {
    if (!inputPath || typeof inputPath !== 'string') return null;
    let sanitized = inputPath.replace(/\0/g, '');
    sanitized = toPosixPath(sanitized);
    const normalized = path.posix.normalize(sanitized);

    // Block traversal patterns
    if (normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) return null;

    // Block paths that normalize to root or system directories
    // Block critical system directories: exposing these would allow
    // information disclosure (/proc, /sys) or system modification (/boot, /dev, /root)
    const dangerousPaths = ['/', '/etc', '/proc', '/sys', '/dev', '/root', '/boot'];
    if (dangerousPaths.includes(normalized) || dangerousPaths.some(d => normalized.startsWith(d + '/'))) {
        return null;
    }

    if (!/^[a-zA-Z0-9/_.-]+$/.test(normalized)) return null;
    return normalized;
}

function escapeShellArg(arg: unknown): string {
    if (arg === null || arg === undefined) return "''";
    if (typeof arg !== 'string') return "''";
    return "'" + arg.replace(/'/g, "'\\''") + "'";
}

function sanitizeShellArg(arg: unknown): string {
    return escapeShellArg(arg);
}

// ============================================================================
// DOCKER VALIDATION
// ============================================================================

function validateDockerAction(action: string): boolean {
    return ['start', 'stop', 'restart'].includes(action);
}

function validateContainerId(containerId: unknown): boolean {
    if (!containerId || typeof containerId !== 'string') return false;
    return /^[a-f0-9]{12,64}$/i.test(containerId);
}

function sanitizeComposeName(name: unknown): string | null {
    if (!name || typeof name !== 'string') return null;
    const sanitized = name.replace(/[^a-zA-Z0-9_-]/g, '');
    if (sanitized.length === 0 || sanitized.length > 50) return null;
    if (!/^[a-zA-Z0-9]/.test(sanitized)) return null;
    return sanitized;
}

function validateComposeContent(content: unknown): ComposeValidationResult {
    if (!content || typeof content !== 'string') {
        return { valid: false, error: 'Content must be a string' };
    }
    if (content.length === 0) {
        return { valid: false, error: 'Content cannot be empty' };
    }
    if (content.length > 100000) {
        return { valid: false, error: 'Content too large (max 100KB)' };
    }

    // Parse as YAML to validate structure
    let parsed: unknown;
    try {
        const yaml = require('js-yaml');
        parsed = yaml.load(content);
    } catch (e: any) {
        if (e.code === 'MODULE_NOT_FOUND') {
            console.warn('[sanitize] js-yaml not available, falling back to regex validation');
            // js-yaml not available: fall back to strict keyword check
            // Require 'services:' with a colon to avoid plain-text false positives
            if (!/^\s*services\s*:/m.test(content)) {
                return { valid: false, error: 'docker-compose must have a "services" key' };
            }
            return { valid: true };
        }
        return { valid: false, error: `Invalid YAML: ${e.message}` };
    }

    if (!parsed || typeof parsed !== 'object') {
        return { valid: false, error: 'docker-compose must be a YAML object' };
    }

    // A valid docker-compose file must have a 'services' key
    if (!(parsed as any).services || typeof (parsed as any).services !== 'object') {
        return { valid: false, error: 'docker-compose must have a "services" key' };
    }

    return { valid: true };
}

// ============================================================================
// SYSTEM VALIDATION
// ============================================================================

function validateSystemAction(action: string): boolean {
    return ['reboot', 'shutdown'].includes(action);
}

function validateFanId(fanId: unknown): number | null {
    const num = parseInt(fanId as string);
    if (isNaN(num) || num < 1 || num > 10) return null;
    return num;
}

function validateFanSpeed(speed: unknown): number | null {
    const num = parseInt(speed as string);
    if (isNaN(num) || num < 0 || num > 100) return null;
    return num;
}

function validateFanMode(mode: unknown): string | null {
    const validModes = ['silent', 'balanced', 'performance'];
    return validModes.includes(mode as string) ? (mode as string) : null;
}

// ============================================================================
// NETWORK VALIDATION
// ============================================================================

function validateInterfaceName(name: unknown): boolean {
    if (!name || typeof name !== 'string') return false;
    return /^[a-z0-9:._-]{1,15}$/i.test(name);
}

function validateIPv4(ip: unknown): boolean {
    if (!ip || typeof ip !== 'string') return false;
    const parts = ip.split('.');
    if (parts.length !== 4) return false;
    for (const part of parts) {
        const num = parseInt(part);
        if (isNaN(num) || num < 0 || num > 255) return false;
        if (part !== num.toString()) return false;
    }
    return true;
}

function validateSubnetMask(mask: string): boolean {
    if (!validateIPv4(mask)) return false;
    const validOctets = [0, 128, 192, 224, 240, 248, 252, 254, 255];
    const parts = mask.split('.').map(Number);
    let foundZero = false;
    for (const part of parts) {
        if (foundZero && part !== 0) return false;
        if (part === 0) foundZero = true;
        if (!validOctets.includes(part)) return false;
    }
    return true;
}

// ============================================================================
// STORAGE VALIDATION
// ============================================================================

function validateDiskRole(role: unknown): string | null {
    const validRoles = ['data', 'parity', 'cache', 'none'];
    return validRoles.includes(role as string) ? (role as string) : null;
}

function validateDiskConfig(disks: unknown): ValidatedDisk[] | null {
    if (!Array.isArray(disks)) return null;
    if (disks.length === 0 || disks.length > 20) return null;
    const validated: ValidatedDisk[] = [];
    for (const disk of disks) {
        if (!disk || typeof disk !== 'object') return null;
        const id = sanitizeDiskId((disk as any).id);
        if (!id) return null;
        const role = validateDiskRole((disk as any).role);
        if (!role) return null;
        const format = (disk as any).format === true;
        validated.push({ id, role, format });
    }
    return validated;
}

function validatePositiveInt(value: unknown, max: number = Number.MAX_SAFE_INTEGER): number | null {
    const num = parseInt(value as string);
    if (isNaN(num) || num < 1 || num > max) return null;
    return num;
}

function validateNonNegativeInt(value: unknown, max: number = Number.MAX_SAFE_INTEGER): number | null {
    const num = parseInt(value as string);
    if (isNaN(num) || num < 0 || num > max) return null;
    return num;
}

function sanitizeForLog(str: unknown): string {
    if (!str || typeof str !== 'string') return '[invalid]';
    return str
        .replace(/password[=:]\s*\S+/gi, 'password=[REDACTED]')
        .replace(/token[=:]\s*\S+/gi, 'token=[REDACTED]')
        .replace(/key[=:]\s*\S+/gi, 'key=[REDACTED]')
        .replace(/secret[=:]\s*\S+/gi, 'secret=[REDACTED]')
        .substring(0, 500);
}

module.exports = {
    sanitizeString,
    sanitizeUsername,
    validateUsername,
    validatePassword,
    sanitizeDiskId,
    sanitizeDiskPath,
    sanitizePath,
    sanitizePathWithinBase,
    sanitizeShellArg,
    escapeShellArg,
    validateDockerAction,
    validateContainerId,
    sanitizeComposeName,
    validateComposeContent,
    validateSystemAction,
    validateFanId,
    validateFanSpeed,
    validateFanMode,
    validateInterfaceName,
    validateIPv4,
    validateSubnetMask,
    validateDiskRole,
    validateDiskConfig,
    validatePositiveInt,
    validateNonNegativeInt,
    sanitizeForLog
};
