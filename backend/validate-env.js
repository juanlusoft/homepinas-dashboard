/**
 * HomePiNAS - Environment Variable Validation
 * Validates required env vars at startup and warns about optional ones.
 * Call once during server bootstrap.
 */

const log = require('./logger');

/** @type {{ name: string, required: boolean, default?: string }[]} */
const ENV_VARS = [
    { name: 'PORT', required: false, default: '443' },
    { name: 'LOG_LEVEL', required: false, default: 'info' },
    { name: 'NODE_ENV', required: false, default: 'production' },
    { name: 'SSL_KEY', required: false, default: '/opt/homepinas/certs/key.pem' },
    { name: 'SSL_CERT', required: false, default: '/opt/homepinas/certs/cert.pem' },
];

/**
 * Validate environment variables. Exits process if required vars are missing.
 */
function validateEnv() {
    let hasErrors = false;

    for (const v of ENV_VARS) {
        if (!process.env[v.name]) {
            if (v.required) {
                log.error(`Missing required env var: ${v.name}`);
                hasErrors = true;
            } else if (v.default) {
                process.env[v.name] = v.default;
                log.debug(`Env ${v.name} not set, using default: ${v.default}`);
            }
        }
    }

    if (hasErrors) {
        log.error('Required environment variables missing. Exiting.');
        process.exit(1);
    }

    log.info('Environment validated OK');
}

module.exports = { validateEnv };
