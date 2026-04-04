/**
 * HomePiNAS - Security Utilities
 * v1.5.6 - Modular Architecture
 *
 * Security logging and safe command execution
 */

import type { ExecFileOptions } from 'child_process';

const log = require('./logger');
const { execFile } = require('child_process');
const util = require('util');
const execFileAsync = util.promisify(execFile);
const fs = require('fs').promises;
const path = require('path');

interface ExecResult {
    stdout: string;
    stderr: string;
}

/**
 * Security event logging
 */
function logSecurityEvent(event: string, user: Record<string, unknown>, ipOrMeta?: string | Record<string, unknown>): void {
    const timestamp = new Date().toISOString();
    let ip = '-';
    let meta: Record<string, unknown> | null = null;
    if (typeof ipOrMeta === 'string') {
        ip = ipOrMeta;
    } else if (ipOrMeta && typeof ipOrMeta === 'object') {
        ip = (ipOrMeta as Record<string, unknown>).ip || '-';
        meta = { ...ipOrMeta as Record<string, unknown> };
        delete meta.ip;
    }
    const metaStr = meta && Object.keys(meta).length > 0 ? ` | ${JSON.stringify(meta)}` : '';
    log.info(`[SECURITY] ${timestamp} | ${event} | IP: ${ip} | ${JSON.stringify(user)}${metaStr}`);
}

/**
 * Execute command with sanitized arguments using execFile (safer than exec)
 */
async function safeExec(command: string, args: string[] = [], options: ExecFileOptions = {}): Promise<ExecResult> {
    // SECURITY: Only specific commands allowed. NO sudo/dd/bash (audit 2026-02-08)
    // Use safeRemove() for file deletion, Node fs for scripts
    // sudo must be invoked directly by routes that need it, with specific sub-commands
    const allowedCommands = [
        'cat', 'ls', 'df', 'mount', 'umount', 'smartctl',
        'systemctl', 'snapraid', 'mergerfs', 'smbpasswd', 'useradd',
        'usermod', 'chown', 'chmod', 'mkfs.ext4', 'mkfs.xfs', 'parted',
        'partprobe', 'id', 'getent', 'cp', 'tee', 'mkdir',
        'journalctl', 'smbstatus', 'smbd', 'nmbd', 'userdel',
        'apcaccess', 'apctest', 'upsc', 'upscmd', 'rsync', 'tar',
        'crontab', 'mv', 'grep', 'blkid', 'lsblk', 'findmnt',
        'mkswap', 'swapon', 'swapoff', 'fdisk', 'xorriso', 'mksquashfs',
        'wg', 'qrencode', 'which', 'ip'
    ];

    // Require absolute path or resolve from PATH - no path traversal tricks
    const baseCommand = path.basename(command);
    if (!allowedCommands.includes(baseCommand)) {
        throw new Error(`Command not allowed: ${baseCommand}`);
    }

    // If command is an absolute path, ensure it's in a safe system directory
    if (command.includes('/')) {
        const safeDirs = ['/bin/', '/sbin/', '/usr/bin/', '/usr/sbin/', '/usr/local/bin/', '/usr/local/sbin/'];
        const inSafeDir = safeDirs.some(dir => command.startsWith(dir));
        if (!inSafeDir) {
            throw new Error(`Command path not in safe directory: ${command}`);
        }
    }

    // Apply security options AFTER user options to prevent override
    const userOpts = { ...options };
    delete userOpts.timeout;
    delete userOpts.maxBuffer;

    return execFileAsync(command, args, {
        ...userOpts,
        timeout: options.timeout || 30000,
        maxBuffer: 10 * 1024 * 1024,
    });
}

/**
 * Execute command with sudo - only specific subcommands allowed
 * Use this for system administration tasks that require root
 */
async function sudoExec(subCommand: string, args: string[] = [], options: ExecFileOptions = {}): Promise<ExecResult> {
    // SECURITY: Only these commands can be run with sudo
    const allowedSudoCommands = [
        'cp', 'mv', 'chown', 'chmod', 'mkdir', 'tee', 'cat',
        'systemctl', 'smbpasswd', 'useradd', 'usermod', 'userdel',
        'mount', 'umount', 'mkfs.ext4', 'mkfs.xfs', 'parted', 'partprobe',
        'samba-tool', 'net', 'testparm',
        'apt-get', 'dpkg', 'fuser', 'killall', 'rm', 'sysctl', 'wg'
    ];

    const baseCommand = path.basename(subCommand);
    if (!allowedSudoCommands.includes(baseCommand)) {
        throw new Error(`Sudo command not allowed: ${baseCommand}`);
    }

    // If command is an absolute path, ensure it's in a safe system directory
    if (subCommand.includes('/')) {
        const safeDirs = ['/bin/', '/sbin/', '/usr/bin/', '/usr/sbin/', '/usr/local/bin/', '/usr/local/sbin/'];
        const inSafeDir = safeDirs.some(dir => subCommand.startsWith(dir));
        if (!inSafeDir) {
            throw new Error(`Command path not in safe directory: ${subCommand}`);
        }
    }

    // Validate args don't contain shell metacharacters
    for (const arg of args) {
        if (typeof arg !== 'string') {
            throw new Error('Invalid argument type');
        }
        // Block obvious shell injection attempts
        if (/[;&|`$()]/.test(arg)) {
            throw new Error('Invalid characters in argument');
        }
    }

    const userOpts = { ...options };
    delete userOpts.timeout;
    delete userOpts.maxBuffer;

    return execFileAsync('sudo', [subCommand, ...args], {
        ...userOpts,
        timeout: options.timeout || 30000,
        maxBuffer: 10 * 1024 * 1024,
    });
}

/**
 * Safe file/directory removal with path traversal protection
 */
async function safeRemove(targetPath: string, basePath: string): Promise<void> {
    if (!basePath) throw new Error('basePath is required for safe removal');

    const resolvedBase = path.posix.normalize(String(basePath).replace(/\\/g, '/'));
    if (!resolvedBase.startsWith('/')) {
        throw new Error('basePath must be an absolute POSIX path');
    }

    const cleanTarget = String(targetPath || '')
        .replace(/\0/g, '')
        .replace(/\\/g, '/')
        .replace(/^\/+/, '');
    const resolvedTarget = path.posix.resolve(resolvedBase, cleanTarget || '.');

    // Prevent path traversal
    if (!resolvedTarget.startsWith(resolvedBase + '/') && resolvedTarget !== resolvedBase) {
        throw new Error('Path traversal attempt blocked');
    }

    // Prevent removing the base directory itself
    if (resolvedTarget === resolvedBase) {
        throw new Error('Cannot remove base directory');
    }

    return fs.rm(resolvedTarget, { recursive: true, force: true });
}

module.exports = {
    logSecurityEvent,
    safeExec,
    sudoExec,
    safeRemove
};
