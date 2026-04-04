/**
 * File Manager — Upload & Drag-Drop
 * Handles file upload (XHR with progress) and drag-and-drop onto the layout.
 */

import { authFetch } from '../api.js';
import { showNotification } from '../notifications.js';
import { state } from '../state.js';
import { _trackListener } from './listeners.js';

const API_BASE = '/api';

// Filled in by index.js so upload knows where to PUT files
let _getCurrentPath = () => '/';
export function setGetCurrentPath(fn) { _getCurrentPath = fn; }

// Callback invoked after a successful upload to refresh the file list
let _onUploadDone = async () => {};
export function setOnUploadDone(fn) { _onUploadDone = fn; }

export function triggerFileUpload() {
    const input = document.getElementById('file-upload-input');
    if (input) input.click();
}

/**
 * Handle file upload
 * @async
 * @param {Event|FileList} e - Input change event or raw FileList
 */
export async function handleFileUpload(e) {
    const files = e.target ? e.target.files : e;
    if (!files || files.length === 0) return;

    const progressEl = document.getElementById('fm-upload-progress');
    const filenameEl = document.getElementById('fm-upload-filename');
    const percentEl  = document.getElementById('fm-upload-percent');
    const fillEl     = document.getElementById('fm-progress-fill');
    if (progressEl) progressEl.style.display = 'block';

    const fileArray = Array.from(files);
    for (let idx = 0; idx < fileArray.length; idx++) {
        const file = fileArray[idx];
        if (filenameEl) filenameEl.textContent = `(${idx + 1}/${fileArray.length}) ${file.name}`;
        if (percentEl)  percentEl.textContent  = '0%';
        if (fillEl)     fillEl.style.width      = '0%';

        const formData = new FormData();
        formData.append('files', file);
        formData.append('path', _getCurrentPath());

        let uploadStartTime = Date.now();
        let lastLoaded = 0;
        let lastTime   = uploadStartTime;

        try {
            const doUpload = () => new Promise((resolve, reject) => {
                const xhr = new XMLHttpRequest();
                xhr.open('POST', `${API_BASE}/files/upload`);
                xhr.setRequestHeader('X-Session-Id', state.sessionId);
                if (state.csrfToken) xhr.setRequestHeader('X-CSRF-Token', state.csrfToken);
                uploadStartTime = Date.now();
                lastTime        = uploadStartTime;
                lastLoaded      = 0;

                const progressHandler = (ev) => {
                    if (ev.lengthComputable) {
                        const pct  = Math.round((ev.loaded / ev.total) * 100);
                        const now  = Date.now();
                        const elapsed = (now - lastTime) / 1000;

                        let speed = 0;
                        if (elapsed > 0.1) {
                            const bytesDelta = ev.loaded - lastLoaded;
                            speed      = bytesDelta / elapsed;
                            lastLoaded = ev.loaded;
                            lastTime   = now;
                        }

                        const totalElapsed = (now - uploadStartTime) / 1000;
                        const avgSpeed  = totalElapsed > 0 ? ev.loaded / totalElapsed : 0;
                        const remaining = ev.total - ev.loaded;
                        const eta       = avgSpeed > 0 ? remaining / avgSpeed : 0;

                        let speedStr = '';
                        if (speed > 0 || avgSpeed > 0) {
                            const displaySpeed = speed > 0 ? speed : avgSpeed;
                            if (displaySpeed >= 1024 * 1024 * 1024) {
                                speedStr = (displaySpeed / (1024 * 1024 * 1024)).toFixed(1) + ' GB/s';
                            } else if (displaySpeed >= 1024 * 1024) {
                                speedStr = (displaySpeed / (1024 * 1024)).toFixed(1) + ' MB/s';
                            } else if (displaySpeed >= 1024) {
                                speedStr = (displaySpeed / 1024).toFixed(0) + ' KB/s';
                            } else {
                                speedStr = displaySpeed.toFixed(0) + ' B/s';
                            }
                        }

                        let etaStr = '';
                        if (eta > 0 && eta < 86400) {
                            if (eta >= 3600) {
                                etaStr = Math.floor(eta / 3600) + 'h ' + Math.floor((eta % 3600) / 60) + 'm';
                            } else if (eta >= 60) {
                                etaStr = Math.floor(eta / 60) + 'm ' + Math.floor(eta % 60) + 's';
                            } else {
                                etaStr = Math.floor(eta) + 's';
                            }
                        }

                        if (percentEl) {
                            percentEl.textContent = `${pct}%${speedStr ? ' • ' + speedStr : ''}${etaStr ? ' • ' + etaStr : ''}`;
                        }
                        if (fillEl) fillEl.style.width = pct + '%';
                    }
                };
                xhr.upload.addEventListener('progress', progressHandler);
                _trackListener(xhr.upload, 'progress', progressHandler);

                const loadHandler = () => {
                    if (xhr.status >= 200 && xhr.status < 300) resolve();
                    else reject({ status: xhr.status, response: xhr.responseText });
                };
                xhr.addEventListener('load', loadHandler);
                _trackListener(xhr, 'load', loadHandler);

                const errorHandler = () => reject({ status: 0, response: 'Network error' });
                xhr.addEventListener('error', errorHandler);
                _trackListener(xhr, 'error', errorHandler);

                xhr.send(formData);
            });

            try {
                await doUpload();
            } catch (uploadErr) {
                if (uploadErr.status === 403) {
                    console.log('CSRF token expired, refreshing...');
                    try {
                        const refreshRes = await fetch(`${API_BASE}/verify-session`, {
                            method: 'POST',
                            headers: { 'X-Session-Id': state.sessionId }
                        });
                        if (refreshRes.ok) {
                            const data = await refreshRes.json();
                            if (data.csrfToken) {
                                state.csrfToken = data.csrfToken;
                                sessionStorage.setItem('csrfToken', data.csrfToken);
                                console.log('CSRF token refreshed, retrying upload...');
                                await doUpload();
                            } else {
                                throw new Error('No CSRF token in response');
                            }
                        }
                    } catch (refreshErr) {
                        throw new Error('Upload failed: ' + uploadErr.status);
                    }
                } else {
                    throw new Error('Upload failed: ' + uploadErr.status);
                }
            }
        } catch (err) {
            console.error('Upload error:', err);
            showNotification(`Error al subir ${file.name}`, 'error');
        }
    }

    if (progressEl) {
        if (fillEl)     fillEl.style.width      = '100%';
        if (filenameEl) filenameEl.textContent   = '✅ Subida completada';
        setTimeout(() => { progressEl.style.display = 'none'; }, 2000);
    }

    if (e.target) e.target.value = '';
    await _onUploadDone();
}

export function fmSetupDragDrop(container) {
    let dragCounter = 0;
    const dropZone = document.getElementById('fm-drop-zone');
    if (!dropZone) return;

    const showDrop = () => dropZone.classList.add('active');
    const hideDrop = () => { dropZone.classList.remove('active'); dragCounter = 0; };

    const dragenterHandler = (e) => {
        e.preventDefault();
        dragCounter++;
        if (e.dataTransfer.types.includes('Files')) showDrop();
    };
    container.addEventListener('dragenter', dragenterHandler);
    _trackListener(container, 'dragenter', dragenterHandler);

    const dragleaveHandler = (e) => {
        e.preventDefault();
        dragCounter--;
        if (dragCounter <= 0) hideDrop();
    };
    container.addEventListener('dragleave', dragleaveHandler);
    _trackListener(container, 'dragleave', dragleaveHandler);

    const dragoverHandler = (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
    };
    container.addEventListener('dragover', dragoverHandler);
    _trackListener(container, 'dragover', dragoverHandler);

    const dropHandler = (e) => {
        e.preventDefault();
        hideDrop();
        if (e.dataTransfer.files.length > 0) {
            handleFileUpload(e.dataTransfer.files);
        }
    };
    container.addEventListener('drop', dropHandler);
    _trackListener(container, 'drop', dropHandler);
}
