'use strict';
const router = require('express').Router();
const crypto = require('crypto');
const { withData, getData } = require('../data');
const { requireAuth } = require('../auth');
const { requirePermission } = require('../rbac');
const log = require('../logger');

const DEFAULT_SHORTCUTS = [
    { id: 'default-1', name: 'Disk Usage', command: 'df -h', description: 'Show disk space usage', icon: '💾', isDefault: true },
    { id: 'default-2', name: 'Services', command: 'systemctl list-units --type=service --state=running', description: 'List running services', icon: '⚙️', isDefault: true },
    { id: 'default-3', name: 'Network', command: 'ip addr show', description: 'Show network interfaces', icon: '🌐', isDefault: true },
    { id: 'default-4', name: 'Processes', command: 'top -bn1 | head -20', description: 'Show top processes', icon: '📊', isDefault: true },
    { id: 'default-5', name: 'Logs', command: 'journalctl -n 50 --no-pager', description: 'Recent system logs', icon: '📜', isDefault: true }
];

router.get('/', requireAuth, (req, res) => {
    try {
        const data = getData();
        res.json({ defaults: DEFAULT_SHORTCUTS, custom: data.shortcuts || [] });
    } catch (err) {
        log.error('[shortcuts] GET failed:', err);
        res.status(500).json({ error: 'Failed to load shortcuts' });
    }
});

router.post('/', requireAuth, requirePermission('write'), async (req, res) => {
    try {
        const { name, command, description, icon } = req.body || {};
        if (!name || typeof name !== 'string' || name.trim().length === 0) return res.status(400).json({ error: 'name is required' });
        if (name.trim().length > 40) return res.status(400).json({ error: 'name must be 40 characters or fewer' });
        if (!command || typeof command !== 'string' || command.trim().length === 0) return res.status(400).json({ error: 'command is required' });
        if (command.length > 500) return res.status(400).json({ error: 'command too long (max 500 chars)' });
        if (icon !== undefined && icon !== null) {
            if (typeof icon !== 'string' || icon.length > 10) return res.status(400).json({ error: 'icon must be a short string (max 10 chars) or omitted' });
        }

        let created;
        await withData(data => {
            const shortcuts = data.shortcuts || [];
            if (shortcuts.length >= 50) return data;
            created = {
                id: crypto.randomUUID(),
                name: name.trim().substring(0, 40),
                command: command.trim(),
                description: description ? String(description).substring(0, 200) : '',
                icon: icon ? String(icon).substring(0, 10) : '',
                isDefault: false,
                createdAt: new Date().toISOString()
            };
            data.shortcuts = [...shortcuts, created];
            return data;
        });

        if (!created) return res.status(400).json({ error: 'Maximum 50 custom shortcuts reached' });
        res.status(201).json(created);
    } catch (err) {
        log.error('[shortcuts] POST failed:', err);
        res.status(500).json({ error: 'Failed to create shortcut' });
    }
});

router.delete('/:id', requireAuth, requirePermission('write'), async (req, res) => {
    try {
        const { id } = req.params;
        if (!id || typeof id !== 'string') return res.status(400).json({ error: 'Invalid id' });
        if (DEFAULT_SHORTCUTS.some(s => s.id === id)) return res.status(400).json({ error: 'Cannot delete default shortcuts' });

        let found = false;
        await withData(data => {
            const shortcuts = data.shortcuts || [];
            const filtered = shortcuts.filter(s => s.id !== id);
            found = filtered.length < shortcuts.length;
            data.shortcuts = filtered;
            return data;
        });

        if (!found) return res.status(404).json({ error: 'Shortcut not found' });
        res.json({ success: true });
    } catch (err) {
        log.error('[shortcuts] DELETE failed:', err);
        res.status(500).json({ error: 'Failed to delete shortcut' });
    }
});

module.exports = router;
