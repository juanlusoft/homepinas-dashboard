/**
 * HomePiNAS - Terminal WebSocket Handler
 * v2.2.3 - PTY WebSocket integration (manual install only)
 *
 * Handles WebSocket connections for web terminal
 */

import type { IPty } from 'node-pty';
import type { WebSocket as WsWebSocket, WebSocketServer } from 'ws';
import type { Server, IncomingMessage } from 'http';

const log = require('./logger');
const wsModule = require('ws');
const { WebSocketServer: WsServer } = wsModule;
const WS_OPEN: number = wsModule.WebSocket.OPEN;
const pty = require('node-pty');
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const { validateSession } = require('./session');
const { logSecurityEvent } = require('./security');

// Terminal session type definition
interface TerminalSession {
    id: string;
    process: IPty;
    ws: WsWebSocket;
    command: string;
    user: string;
    startTime: number;
}

// Active terminal sessions
const terminalSessions = new Map<string, TerminalSession>();

// Allowed commands (whitelist)
const ALLOWED_COMMANDS = [
    'bash', 'sh', 'htop', 'top', 'mc', 'nano', 'vim', 'vi',
    'less', 'more', 'cat', 'ls', 'cd', 'pwd', 'df', 'du',
    'free', 'ps', 'journalctl', 'systemctl', 'docker', 'tmux'
];

// Map commands to their package names (for auto-install)
const COMMAND_PACKAGES: Record<string, string> = {
    'htop': 'htop',
    'mc': 'mc',
    'nano': 'nano',
    'vim': 'vim',
    'tmux': 'tmux',
    'docker': 'docker.io'
};

// SECURITY: Validate command and arguments
function validateCommand(cmd: unknown): boolean {
    if (!cmd || typeof cmd !== 'string') return false;
    const trimmed = cmd.trim();
    // Don't allow paths
    if (trimmed.includes('/')) return false;

    // Parse command and check if base command is allowed
    const parts = trimmed.split(' ');
    const baseCmd = parts[0];
    return ALLOWED_COMMANDS.includes(baseCmd);
}

// Check if command exists (safe - no shell interpolation)
function commandExists(cmd: string): boolean {
    try {
        execFileSync('which', [cmd], { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

function setupTerminalWebSocket(server: Server): WebSocketServer {
    const wss = new WsServer({
        server,
        path: '/api/terminal/ws'
    });

    wss.on('connection', (ws: WsWebSocket, req: IncomingMessage) => {
        // Extract command and auth from URL
        const urlParts = (req.url ?? '').split('?');
        const params = new URLSearchParams(urlParts[1] || '');
        // SECURITY: Generate sessionId server-side, don't trust client
        const sessionId = crypto.randomBytes(16).toString('hex');
        const command = params.get('command') || 'bash';
        const authToken = params.get('token');

        // Validate authentication
        const session = validateSession(authToken);
        if (!session) {
            ws.send(JSON.stringify({ type: 'error', message: 'Authentication required' }));
            ws.close(1008, 'Authentication required');
            return;
        }

        // Validate command
        if (!validateCommand(command)) {
            ws.send(JSON.stringify({ type: 'error', message: 'Command not allowed' }));
            ws.close(1008, 'Command not allowed');
            return;
        }

        log.info(`[Terminal] New session: ${sessionId}, command: ${command}, user: ${session.username}`);

        // Get base command (first word)
        const baseCmd = command.split(' ')[0].split('/').pop();

        // Check if command exists — do NOT auto-install (security risk)
        if (!commandExists(baseCmd!)) {
            log.info(`[Terminal] Command not found: ${baseCmd}`);
            const pkg = COMMAND_PACKAGES[baseCmd!] || baseCmd;
            ws.send(JSON.stringify({
                type: 'output',
                data: `\x1b[31m[HomePiNAS] Comando '${baseCmd}' no encontrado.\x1b[0m\r\n`
            }));
            ws.send(JSON.stringify({
                type: 'output',
                data: `\x1b[33mInstala manualmente: sudo apt install ${pkg}\x1b[0m\r\n`
            }));
            ws.send(JSON.stringify({ type: 'exit', exitCode: 1 }));
            ws.close(1000, 'Command not available');
            return;
        }

        // Create PTY process
        let ptyProcess: IPty;
        try {
            // Parse command — strip all user-supplied arguments for security
            // Terminal shells (bash, zsh, sh) don't need client-supplied args
            // Client-supplied args could enable injection attacks:
            // e.g., bash --init-file /malicious/script or bash -c "rm -rf /"
            const cmd = command.trim().split(' ')[0];
            const args: string[] = []; // Never pass user-supplied args to PTY — security risk

            // SECURITY: Only spawn the exact validated command
            ptyProcess = pty.spawn(cmd, args, {
                name: 'xterm-256color',
                cols: 80,
                rows: 24,
                cwd: process.env.HOME || '/home',
                env: {
                    ...process.env,
                    TERM: 'xterm-256color',
                    COLORTERM: 'truecolor',
                    LANG: 'en_US.UTF-8'
                }
            });
        } catch (err) {
            log.error('[Terminal] Failed to spawn PTY:', err);
            ws.send(JSON.stringify({ type: 'error', message: 'Failed to start terminal' }));
            ws.close(1011, 'Failed to start terminal');
            return;
        }

        // Store session
        const termSession: TerminalSession = {
            id: sessionId,
            process: ptyProcess,
            ws: ws,
            command: command,
            user: session.username,
            startTime: Date.now()
        };
        terminalSessions.set(sessionId, termSession);

        logSecurityEvent('TERMINAL_PTY_STARTED', {
            sessionId,
            command,
            user: session.username
        }, req.socket.remoteAddress);

        // Send ready message
        ws.send(JSON.stringify({ type: 'ready', sessionId }));

        // Forward PTY output to WebSocket
        ptyProcess.onData((data: string) => {
            if (ws.readyState === WS_OPEN) {
                ws.send(JSON.stringify({ type: 'output', data }));
            }
        });

        // Handle PTY exit
        ptyProcess.onExit(({ exitCode, signal }: { exitCode: number; signal?: number }) => {
            log.info(`[Terminal] PTY exited: ${sessionId}, code: ${exitCode}, signal: ${signal}`);
            terminalSessions.delete(sessionId);

            if (ws.readyState === WS_OPEN) {
                ws.send(JSON.stringify({
                    type: 'exit',
                    exitCode,
                    signal,
                    message: `Process exited with code ${exitCode}`
                }));
                ws.close(1000, 'Process terminated');
            }
        });

        // Handle WebSocket messages (input from client)
        ws.on('message', (message: unknown) => {
            try {
                const msg = JSON.parse((message as Buffer).toString());

                switch (msg.type) {
                    case 'input':
                        if (msg.data && ptyProcess) {
                            ptyProcess.write(msg.data);
                        }
                        break;

                    case 'resize':
                        if (msg.cols && msg.rows && ptyProcess) {
                            ptyProcess.resize(
                                Math.min(Math.max(msg.cols, 10), 500),
                                Math.min(Math.max(msg.rows, 5), 200)
                            );
                        }
                        break;

                    case 'ping':
                        ws.send(JSON.stringify({ type: 'pong' }));
                        break;
                }
            } catch (err) {
                log.error('[Terminal] Message parse error:', err);
            }
        });

        // Handle WebSocket close
        ws.on('close', () => {
            log.info(`[Terminal] WebSocket closed: ${sessionId}`);

            if (ptyProcess) {
                try {
                    ptyProcess.kill();
                } catch {
                    // process already exited
                }
            }
            terminalSessions.delete(sessionId);

            logSecurityEvent('TERMINAL_SESSION_CLOSED', {
                sessionId,
                user: session.username
            }, '');
        });

        // Handle WebSocket error
        ws.on('error', (err: Error) => {
            log.error(`[Terminal] WebSocket error: ${sessionId}`, err);

            if (ptyProcess) {
                try {
                    ptyProcess.kill();
                } catch {
                    // process already exited
                }
            }
            terminalSessions.delete(sessionId);
        });
    });

    log.info('[Terminal] WebSocket server initialized at /api/terminal/ws');
    return wss;
}

// Get active sessions
function getActiveSessions(): Array<{ id: string; command: string; user: string; startTime: number }> {
    const sessions = [];
    for (const [id, session] of terminalSessions) {
        sessions.push({
            id,
            command: session.command,
            user: session.user,
            startTime: session.startTime
        });
    }
    return sessions;
}

// Kill a specific session
function killSession(sessionId: string): boolean {
    const session = terminalSessions.get(sessionId);
    if (session) {
        if (session.process) {
            try {
                session.process.kill('SIGTERM');
            } catch {
                // process already exited
            }
        }
        if (session.ws && session.ws.readyState === WS_OPEN) {
            session.ws.close(1000, 'Session killed by request');
        }
        terminalSessions.delete(sessionId);
        return true;
    }
    return false;
}

module.exports = {
    setupTerminalWebSocket,
    getActiveSessions,
    killSession,
    terminalSessions
};
