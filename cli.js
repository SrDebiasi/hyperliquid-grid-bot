import * as init from './src/functions/init.js';

const usage = () => {
    console.log(`
Usage:
  node src/cli.js start <instanceId>
  node src/cli.js openOrders <instanceId> <pair>
  node src/cli.js cancelOrders <instanceId> <pair>
  node src/cli.js create <instanceId> ... (if you add it)
`);
};

function requireArg(name, value) {
    if (value == null || String(value).trim() === '') {
        throw new Error(`Missing argument: ${name}`);
    }
    return value;
}

async function main() {
    const [cmdRaw, ...args] = process.argv.slice(2);
    const cmd = (cmdRaw ?? '').trim();

    if (!cmd) {
        usage();
        process.exit(1);
    }

    const fn = init[cmd];
    if (typeof fn !== 'function') {
        console.log(`Unknown command: ${cmd}`);
        usage();
        process.exit(1);
    }

    // Convert instance id to number when present (most of your fns expect it)
    // Keep other args as-is (pair, etc.)
    const mappedArgs = args.map((a, idx) => (idx === 0 ? Number(a) : a));

    // Basic validation for instance id for the commands that use it
    if (['start', 'openOrders', 'cancelOrders', 'startBot', 'test'].includes(cmd)) {
        const instanceId = mappedArgs[0];
        if (!Number.isFinite(instanceId)) {
            throw new Error(`Invalid instanceId for "${cmd}". Example: node src/cli.js ${cmd} 1`);
        }
    }

    await fn(...mappedArgs);
}

main().catch((err) => {
    console.error(err?.stack ?? String(err));
    process.exit(1);
});
