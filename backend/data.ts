/**
 * HomePiNAS - Data Storage Utilities
 * v1.5.7 - Modular Architecture
 *
 * JSON file-based configuration storage with atomic writes
 * and in-process mutex to prevent concurrent write corruption.
 */

const log = require('./logger');
const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', 'config', 'data.json');

interface AppData {
  notifications?: {
    email?: Record<string, unknown>;
    telegram?: Record<string, unknown>;
  };
  shortcuts?: Array<Record<string, unknown>>;
  users?: Record<string, unknown>;
  settings?: Record<string, unknown>;
  [key: string]: unknown;
}

const initialState: AppData = {
    user: null,
    users: [],
    storageConfig: [],
    network: {
        interfaces: [
            { id: 'eth0', name: 'Ethernet', ip: '192.168.1.100', subnet: '255.255.255.0', gateway: '192.168.1.1', dns: '8.8.8.8', dhcp: true, status: 'connected' },
            { id: 'eth1', name: 'Ethernet 2', ip: '10.0.0.15', subnet: '255.255.255.0', gateway: '10.0.0.1', dns: '10.0.0.1', dhcp: false, status: 'connected' },
            { id: 'wlan0', name: 'Wi-Fi', ip: '192.168.1.105', subnet: '255.255.255.0', gateway: '192.168.1.1', dns: '1.1.1.1', dhcp: true, status: 'disconnected' }
        ],
        ddns: []
    },
    notifications: {
        email: null,
        telegram: null,
        history: [],
        errorReporting: null
    },
    backups: [],
    scheduledTasks: [],
    ups: {
        config: {
            lowBatteryThreshold: 30,
            criticalThreshold: 10,
            notifyOnPower: true,
            shutdownOnCritical: false
        },
        history: []
    }
};

/**
 * In-process mutex for data file access.
 * Node.js is single-threaded but async handlers can interleave:
 *   Request A: getData() → modify → (await something) → saveData()
 *   Request B: getData() → modify → saveData()  ← overwrites A's changes
 *
 * withData() ensures read-modify-write is atomic.
 */
let _dataLock: Promise<void> = Promise.resolve();

/**
 * Execute a read-modify-write operation atomically.
 * The callback receives current data and must return the modified data.
 *
 * Usage:
 *   await withData(data => {
 *       data.users.push(newUser);
 *       return data;
 *   });
 *
 * For read-only access, use getData() directly (no lock needed).
 */
async function withData<T = void>(fn: (data: AppData) => Promise<T> | T): Promise<T> {
    // Promise-chain queue mutex: each call appends itself to the tail of
    // _dataLock. A caller only runs after the previous tail resolves, and the
    // lock is only released (via release()) inside the finally block — which
    // executes AFTER `await fn(data)` completes (or throws). This guarantees
    // serialisation even when fn is async: the next queued caller can never
    // start until the current fn has fully resolved or rejected.
    let release: () => void;
    const next = new Promise<void>(resolve => { release = resolve; });
    const prev = _dataLock;
    _dataLock = next;

    return prev.then(async () => {
        try {
            const data = getData();
            // await ensures async fn is fully complete before finally runs.
            const result = await fn(data);
            if (result !== undefined) {
                saveData(result as AppData);
            }
            return result;
        } finally {
            // release() unblocks the next queued caller only after fn is done.
            release();
        }
    });
}

/**
 * Ensure config directory exists with secure permissions
 */
function ensureConfigDir(): void {
    const configDir = path.dirname(DATA_FILE);
    if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
    }
}

/**
 * Read data from JSON file
 */
function getData(): AppData {
    try {
        ensureConfigDir();
        if (!fs.existsSync(DATA_FILE)) {
            fs.writeFileSync(DATA_FILE, JSON.stringify(initialState, null, 2));
        }
        const content = fs.readFileSync(DATA_FILE, 'utf8');
        return JSON.parse(content);
    } catch (e: unknown) {
        const error = e as Error;
        log.error('Error reading data file:', error.message);
        fs.writeFileSync(DATA_FILE, JSON.stringify(initialState, null, 2));
        return initialState;
    }
}

/**
 * Save data to JSON file with atomic write (write-to-temp + rename)
 * This prevents data corruption if the process crashes mid-write.
 */
function saveData(data: AppData): void {
    try {
        ensureConfigDir();
        const tmpFile = DATA_FILE + '.tmp.' + process.pid;
        fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2), { mode: 0o600 });
        fs.renameSync(tmpFile, DATA_FILE);
    } catch (e: unknown) {
        const error = e as Error;
        log.error('Error saving data file:', error.message);
        // Clean up temp file on failure
        try { fs.unlinkSync(DATA_FILE + '.tmp.' + process.pid); } catch {}
        throw new Error('Failed to save configuration');
    }
}

module.exports = {
    getData,
    saveData,
    withData,
    DATA_FILE,
    initialState
};
