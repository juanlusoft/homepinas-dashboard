/**
 * HomePiNAS - Shared Notification Helpers
 *
 * Reusable email (nodemailer) and Telegram sending functions.
 * Used by both the HTTP notification routes and the server-side error monitor.
 */

const nodemailer = require('nodemailer');
const { getData } = require('./data');

/**
 * Send an email using stored SMTP configuration.
 * @param {string} subject
 * @param {string} text - plain text body
 * @param {string} html - HTML body (optional, falls back to text)
 * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
 */
async function sendViaEmail(subject, text, html) {
    const data = getData();
    const cfg = data.notifications?.email;

    if (!cfg || !cfg.host || !cfg.user || !cfg.password) {
        return { success: false, error: 'Email not configured' };
    }

    try {
        const transporter = nodemailer.createTransport({
            host: cfg.host,
            port: cfg.port,
            secure: cfg.secure,
            auth: { user: cfg.user, pass: cfg.password }
        });

        const info = await transporter.sendMail({
            from: cfg.from,
            to: cfg.to,
            subject,
            text,
            html: html || text
        });

        return { success: true, messageId: info.messageId };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

/**
 * Send a Telegram message using stored bot configuration.
 * @param {string} text - Markdown-formatted message (max 4096 chars)
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function sendViaTelegram(text) {
    const data = getData();
    const cfg = data.notifications?.telegram;

    if (!cfg || !cfg.botToken || !cfg.chatId || !cfg.enabled) {
        return { success: false, error: 'Telegram not configured or disabled' };
    }

    try {
        const url = `https://api.telegram.org/bot${cfg.botToken}/sendMessage`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: cfg.chatId,
                text: text.substring(0, 4096),
                parse_mode: 'Markdown'
            })
        });

        const result = await response.json();
        if (!result.ok) {
            return { success: false, error: result.description };
        }
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

module.exports = { sendViaEmail, sendViaTelegram };
