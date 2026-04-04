/**
 * HomePiNAS - Rate Limiting Middleware
 * v1.5.6 - Modular Architecture
 */

import type { RateLimitRequestHandler } from 'express-rate-limit';

const rateLimit = require('express-rate-limit');

/**
 * General rate limiter - relaxed for local network NAS dashboard
 * SECURITY: Only skip specific high-frequency polling endpoints, not all GETs
 */
const generalLimiter: RateLimitRequestHandler = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 500, // High but not unlimited for local network
    message: { error: 'Too many requests, please try again later' },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req: { path: string }) => {
        // SECURITY: Only skip specific polling endpoints that need high frequency
        const skipPaths = [
            '/api/system/stats',
            '/api/system/fan/mode',
            '/api/docker/containers'
        ];
        return skipPaths.includes(req.path);
    }
});

/**
 * Auth rate limiter - stricter for login attempts
 */
const authLimiter: RateLimitRequestHandler = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10,
    message: { error: 'Too many login attempts, please try again later' }
});

/**
 * Password change/reset rate limiter
 * Stricter than auth limiter to prevent brute-force on password operations
 */
const passwordLimiter: RateLimitRequestHandler = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 5,
    message: { error: 'Too many password change attempts, please try again in an hour' },
    standardHeaders: true,
    legacyHeaders: false
});

/**
 * Critical actions rate limiter
 */
const criticalLimiter: RateLimitRequestHandler = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 10,
    message: { error: 'Too many critical actions, please try again later' }
});

/**
 * Notification rate limiter - prevent spam via email/telegram
 */
const notificationLimiter: RateLimitRequestHandler = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20,
    message: { error: 'Too many notification requests, please try again later' }
});

/**
 * DDNS update rate limiter - prevent excessive API calls to providers
 */
const ddnsLimiter: RateLimitRequestHandler = rateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 10,
    message: { error: 'Too many DDNS update requests, please try again later' }
});

/**
 * VPN management rate limiter - prevent abuse of VPN client creation/install
 */
const vpnLimiter: RateLimitRequestHandler = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20,
    message: { error: 'Too many VPN requests, please try again later' }
});

/**
 * Agent registration rate limiter — CRIT-02 fix
 * Prevents flooding the pending agents list
 */
const agentRegisterLimiter: RateLimitRequestHandler = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 5,
    message: { error: 'Too many agent registration attempts, try again later' },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: { ip: string }) => req.ip // per-IP
});

/**
 * Agent poll/report rate limiter — CRIT-02 fix
 * Normal agents poll every 30-60s; this allows ~1/s burst
 */
const agentPollLimiter: RateLimitRequestHandler = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 60,
    message: { error: 'Too many agent requests, slow down' },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: { ip: string }) => req.ip
});

module.exports = {
    generalLimiter,
    authLimiter,
    passwordLimiter,
    criticalLimiter,
    notificationLimiter,
    ddnsLimiter,
    vpnLimiter,
    agentRegisterLimiter,
    agentPollLimiter
};
