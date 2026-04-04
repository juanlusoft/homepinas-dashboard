/**
 * State Management Module
 * Global application state and state management functions
 * @module state
 */

/**
 * Global application state object
 * @type {Object}
 */
export const state = {
    isAuthenticated: false,
    currentView: 'loading',
    user: null,
    sessionId: null,
    csrfToken: null,
    appVersion: null,
    publicIP: null,
    globalStats: {
        cpuLoad: 0,
        cpuTemp: 0,
        ramUsed: 0,
        ramTotal: 0,
        uptime: 0
    },
    storageConfig: [],
    disks: [],
    network: {
        interfaces: [],
        ddns: []
    },
    dockers: [],
    shortcuts: {
        defaults: [],
        custom: []
    },
    terminalSession: null,
    pollingIntervals: {
        stats: null,
        publicIP: null,
        storage: null,
        diskDetection: null
    }
};

/**
 * State getters - read-only access to state properties
 */
export const getters = {
    /**
     * Check if user is authenticated
     * @returns {boolean}
     */
    isAuthenticated() {
        return state.isAuthenticated;
    },

    /**
     * Get current user info
     * @returns {Object|null}
     */
    getCurrentUser() {
        return state.user;
    },

    /**
     * Get current view name
     * @returns {string}
     */
    getCurrentView() {
        return state.currentView;
    },

    /**
     * Get global system stats
     * @returns {Object}
     */
    getGlobalStats() {
        return state.globalStats;
    },

    /**
     * Get storage configuration
     * @returns {Array}
     */
    getStorageConfig() {
        return state.storageConfig;
    },

    /**
     * Get available disks
     * @returns {Array}
     */
    getDisks() {
        return state.disks;
    },

    /**
     * Get network configuration
     * @returns {Object}
     */
    getNetwork() {
        return state.network;
    },

    /**
     * Get public IP address
     * @returns {string}
     */
    getPublicIP() {
        return state.publicIP;
    },

    /**
     * Get Docker containers
     * @returns {Array}
     */
    getDockers() {
        return state.dockers;
    }
};

/**
 * State setters - controlled modifications to state
 */
export const setters = {
    /**
     * Set authentication state
     * @param {boolean} isAuth
     */
    setAuthenticated(isAuth) {
        state.isAuthenticated = isAuth;
    },

    /**
     * Set current user
     * @param {Object} user
     */
    setUser(user) {
        state.user = user;
    },

    /**
     * Set current view
     * @param {string} viewName
     */
    setCurrentView(viewName) {
        state.currentView = viewName;
    },

    /**
     * Set global stats
     * @param {Object} stats
     */
    setGlobalStats(stats) {
        state.globalStats = { ...state.globalStats, ...stats };
    },

    /**
     * Set storage config
     * @param {Array} config
     */
    setStorageConfig(config) {
        state.storageConfig = config;
    },

    /**
     * Set available disks
     * @param {Array} disks
     */
    setDisks(disks) {
        state.disks = disks;
    },

    /**
     * Set network config
     * @param {Object} network
     */
    setNetwork(network) {
        state.network = { ...state.network, ...network };
    },

    /**
     * Set public IP
     * @param {string} ip
     */
    setPublicIP(ip) {
        state.publicIP = ip;
    },

    /**
     * Set Docker containers
     * @param {Array} containers
     */
    setDockers(containers) {
        state.dockers = containers;
    }
};

/**
 * Local state for DHCP overrides (track user changes before saving)
 */
export const localDhcpState = {};

/**
 * Reset local DHCP state
 */
export function resetLocalDhcpState() {
    Object.keys(localDhcpState).forEach(key => delete localDhcpState[key]);
}

/**
 * Initialize state from server data
 * @param {Object} data - Server response data
 */
export function initStateFromServer(data) {
    if (data.user) state.user = data.user;
    if (data.storageConfig) state.storageConfig = data.storageConfig;
    if (data.network) state.network = data.network;
    if (data.version) state.appVersion = data.version;
}

/**
 * Reset all state to initial values (logout)
 */
export function resetState() {
    state.isAuthenticated = false;
    state.currentView = 'loading';
    state.user = null;
    state.sessionId = null;
    state.csrfToken = null;
    state.publicIP = null;
    state.globalStats = { cpuLoad: 0, cpuTemp: 0, ramUsed: 0, ramTotal: 0, uptime: 0 };
    state.storageConfig = [];
    state.disks = [];
    state.network = { interfaces: [], ddns: [] };
    state.dockers = [];
    state.terminalSession = null;
    resetLocalDhcpState();
}
