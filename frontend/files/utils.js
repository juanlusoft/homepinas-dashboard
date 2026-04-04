/**
 * File Manager — Utility helpers
 * Pure functions: formatting, icons, escaping
 */

export function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

export function formatFileSize(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
}

export function getFileIconSVG(name, size) {
    const s = size || 24;
    const ext = name.split('.').pop().toLowerCase();
    const colorMap = {
        jpg: '#e879f9', jpeg: '#e879f9', png: '#e879f9', gif: '#e879f9', svg: '#e879f9', webp: '#e879f9', bmp: '#e879f9', ico: '#e879f9',
        mp4: '#f97316', mkv: '#f97316', avi: '#f97316', mov: '#f97316', wmv: '#f97316', flv: '#f97316', webm: '#f97316',
        mp3: '#06b6d4', flac: '#06b6d4', wav: '#06b6d4', ogg: '#06b6d4', aac: '#06b6d4', wma: '#06b6d4', m4a: '#06b6d4',
        pdf: '#ef4444', doc: '#3b82f6', docx: '#3b82f6', xls: '#22c55e', xlsx: '#22c55e', ppt: '#f97316', pptx: '#f97316',
        txt: '#94a3b8', md: '#94a3b8', csv: '#22c55e', rtf: '#3b82f6',
        zip: '#eab308', tar: '#eab308', gz: '#eab308', rar: '#eab308', '7z': '#eab308', bz2: '#eab308', xz: '#eab308',
        js: '#eab308', ts: '#3b82f6', py: '#22c55e', sh: '#22c55e', json: '#eab308', yml: '#ef4444', yaml: '#ef4444',
        html: '#f97316', css: '#3b82f6', php: '#8b5cf6', rb: '#ef4444', go: '#06b6d4', rs: '#f97316', java: '#ef4444',
        c: '#3b82f6', cpp: '#3b82f6', h: '#3b82f6', xml: '#f97316', sql: '#3b82f6',
        iso: '#8b5cf6', img: '#8b5cf6', dmg: '#8b5cf6',
        conf: '#94a3b8', cfg: '#94a3b8', ini: '#94a3b8', env: '#94a3b8', log: '#94a3b8', toml: '#94a3b8',
        ttf: '#e879f9', otf: '#e879f9', woff: '#e879f9', woff2: '#e879f9',
    };
    const labelMap = {
        pdf: 'PDF', doc: 'DOC', docx: 'DOC', xls: 'XLS', xlsx: 'XLS', ppt: 'PPT', pptx: 'PPT',
        zip: 'ZIP', tar: 'TAR', gz: 'GZ', rar: 'RAR', '7z': '7Z',
        js: 'JS', ts: 'TS', py: 'PY', sh: 'SH', json: '{ }', yml: 'YML', yaml: 'YML',
        html: 'HTML', css: 'CSS', php: 'PHP', sql: 'SQL',
        mp3: '♪', flac: '♪', wav: '♪', ogg: '♪', aac: '♪', m4a: '♪',
        mp4: '▶', mkv: '▶', avi: '▶', mov: '▶', webm: '▶',
        jpg: '🖼', jpeg: '🖼', png: '🖼', gif: '🖼', svg: '🖼', webp: '🖼',
        iso: 'ISO', img: 'IMG',
    };
    const color = colorMap[ext] || '#94a3b8';
    const rawLabel = labelMap[ext] || ext.toUpperCase().slice(0, 4);
    const label = escapeHtml(rawLabel);
    const labelFontSize = rawLabel.length > 3 ? (s * 0.2) : (s * 0.28);
    return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none">
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" fill="${color}20" stroke="${color}" stroke-width="1.5"/>
        <polyline points="14 2 14 8 20 8" stroke="${color}" stroke-width="1.5"/>
        <text x="12" y="17" text-anchor="middle" fill="${color}" font-size="${labelFontSize}" font-weight="700" font-family="system-ui">${label}</text>
    </svg>`;
}

export function getFolderSVG(size) {
    const s = size || 24;
    return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none">
        <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" fill="#eab30830" stroke="#eab308" stroke-width="1.5"/>
    </svg>`;
}

export function getLocationBadge(path) {
    if (!path) return '';
    if (path.startsWith('/mnt/disks/cache') || path.includes('/cache')) {
        return '<span class="fm-location-badge cache" title="En caché SSD">⚡ cache</span>';
    }
    if (path.startsWith('/mnt/disks/disk')) {
        return '<span class="fm-location-badge data" title="En disco de datos">💾 data</span>';
    }
    if (path.startsWith('/mnt/storage')) {
        return '<span class="fm-location-badge pool" title="Pool MergerFS">📦 pool</span>';
    }
    return '';
}
