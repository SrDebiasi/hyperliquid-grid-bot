// src/services/pm2Service.js
import pm2 from 'pm2';
import fs from 'node:fs';

function pm2Connect() {
    return new Promise((resolve, reject) => {
        pm2.connect((err) => (err ? reject(err) : resolve()));
    });
}

function pm2Disconnect() {
    // pm2.disconnect() does not take a callback
    pm2.disconnect();
}

function pm2List() {
    return new Promise((resolve, reject) => {
        pm2.list((err, list) => (err ? reject(err) : resolve(list)));
    });
}

function pm2Describe(name) {
    return new Promise((resolve, reject) => {
        pm2.describe(name, (err, desc) => (err ? reject(err) : resolve(desc)));
    });
}

function pm2Start(opts) {
    return new Promise((resolve, reject) => {
        pm2.start(opts, (err, proc) => (err ? reject(err) : resolve(proc)));
    });
}

function pm2Stop(name) {
    return new Promise((resolve, reject) => {
        pm2.stop(name, (err) => (err ? reject(err) : resolve()));
    });
}

export function getBotProcessName(instanceId) {
    return `gridbot-${instanceId}`;
}

/**
 * Decide what script PM2 should run.
 *
 * IMPORTANT: update BOT_ENTRY / args to match your bot entry.
 * Based on your logs you currently run:
 *   run-func src/functions/init.js start 1
 *
 * So here we run that same init.js with args: ["start", "<id>"]
 */
function getStartOptions({ instanceId }) {
    const name = getBotProcessName(instanceId);

    return {
        name,
        script: 'cli.js',
        interpreter: 'node',
        args: ['start', String(instanceId)],
        cwd: process.cwd(),
        autorestart: true,
        max_restarts: 10,
        time: true,
        env: {
            ...process.env,
            NODE_ENV: process.env.NODE_ENV ?? 'development',
        },
    };
}

function stripAnsi(s) {
    return String(s).replace(
        // eslint-disable-next-line no-control-regex
        /[\u001B\u009B][[\]()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g,
        ''
    );
}

function normalizeLogText(s) {
    return stripAnsi(String(s))
        .replace(/\\r\\n/g, '\n')
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\n');
}

function tailFile(filePath, lines = 100) {
    try {
        if (!filePath || !fs.existsSync(filePath)) return [];

        const raw = fs.readFileSync(filePath, 'utf-8');

        // normalize first (so \\n becomes real newlines), then split lines
        const normalized = normalizeLogText(raw);
        const arr = normalized.split(/\r?\n/);

        return arr.slice(-lines).filter(Boolean).reverse();
    } catch {
        return [];
    }
}

export async function getBotLogs({ instanceId, lines = 100 }) {
    await pm2Connect();
    try {
        const name = getBotProcessName(instanceId);
        const desc = await pm2Describe(name);
        const proc = Array.isArray(desc) ? desc[0] : null;

        const outPath = proc?.pm2_env?.pm_out_log_path;
        const errPath = proc?.pm2_env?.pm_err_log_path;

        return {
            name,
            out: tailFile(outPath, lines),
            err: tailFile(errPath, lines),
        };
    } finally {
        pm2Disconnect();
    }
}

export async function ensureBotRunning({ instanceId }) {
    await pm2Connect();
    try {
        const name = getBotProcessName(instanceId);

        // If already running, no-op
        const desc = await pm2Describe(name);
        const proc = Array.isArray(desc) ? desc[0] : null;
        const status = proc?.pm2_env?.status;

        if (status === 'online' || status === 'launching') {
            return { name, status };
        }

        // Not running (or not found) → start
        await pm2Start(getStartOptions({ instanceId }));

        // Read back status
        const desc2 = await pm2Describe(name);
        const proc2 = Array.isArray(desc2) ? desc2[0] : null;
        return { name, status: proc2?.pm2_env?.status ?? 'unknown' };
    } finally {
        pm2Disconnect();
    }
}

export async function stopBot({ instanceId }) {
    await pm2Connect();
    try {
        const name = getBotProcessName(instanceId);

        // If not found, treat as stopped (idempotent)
        const list = await pm2List();
        const exists = list.some((p) => p.name === name);
        if (!exists) return { name, status: 'stopped' };

        await pm2Stop(name);
        return { name, status: 'stopped' };
    } finally {
        pm2Disconnect();
    }
}

export async function getBotStatus({ instanceId }) {
    await pm2Connect();
    try {
        const name = getBotProcessName(instanceId);
        const desc = await pm2Describe(name);
        const proc = Array.isArray(desc) ? desc[0] : null;
        const status = proc?.pm2_env?.status;

        const isRunning = status === 'online' || status === 'launching';
        return { name, isRunning, statusText: status ?? 'stopped' };
    } catch (e) {
        // pm2.describe throws if not found
        return { name: getBotProcessName(instanceId), isRunning: false, statusText: 'stopped' };
    } finally {
        pm2Disconnect();
    }
}
