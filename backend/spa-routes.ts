// SPA client-side routes served by the Express backend (index.html fallback).
//
// Module routes (those with a matching entry in frontend/modules/registry.js)
// must be kept in sync with the `route` properties defined there.
// When adding a new frontend module, add its route to BOTH files.

const spaRoutes: string[] = [
  // ── Non-module routes ──────────────────────────────────────────────────────
  '/',
  '/login',
  '/setup',
  '/setup/storage',
  '/stacks',

  // ── Module routes (mirrors frontend/modules/registry.js) ──────────────────
  '/dashboard',
  '/docker',
  '/storage',
  '/files',
  '/network',
  '/system',
  '/terminal',
  '/backup',
  '/logs',
  '/users',
  '/shortcuts',
  '/cloud-sync',
  '/cloud-backup',
  '/homestore',
  '/vpn',
  '/active-backup',
  '/active-directory',
];

module.exports = spaRoutes;
