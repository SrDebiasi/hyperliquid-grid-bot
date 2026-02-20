import { runBacktest } from '../src/backtest/runBacktest.js';
import { FEE_RATE_MAKER_PER_SIDE } from '../src/functions/fees.js';
import fs from 'node:fs';

const BASE_ARGS = {
    symbol: 'BTCUSDT',
    interval: '1m', // Needs to be 1 minute, always otherwise you might miss profits.
    startDate: '01/01/2025',
    endDate: '18/02/2026',
    entry_price: 60000,
    exit_price: 125000,
    margin_percent: 0.1,
    // target_percent: injected
    simulationConfig: {
        baseUsdPerOrder: 50,
        feeRatePerSide: FEE_RATE_MAKER_PER_SIDE,
        enableLogs: false,
    },
};

// inclusive sweep: 0.4 -> 2.5 step 0.1
function buildRange(from, to, step) {
    const out = [];
    // avoid floating errors: work as integers of "tenths"
    const mul = 10; // 0.1 => 1
    const start = Math.round(from * mul);
    const end = Math.round(to * mul);
    const inc = Math.round(step * mul);

    for (let i = start; i <= end; i += inc) {
        out.push(Number((i / mul).toFixed(1)));
    }
    return out;
}

function toCsv(rows) {
    const header = [
        'target_percent',
        'grid_levels',
        'cycles',
        'total_profit',
        'profit_per_cycle',
    ];
    const lines = [header.join(',')];

    for (const r of rows) {
        lines.push(
            [
                r.target_percent,
                r.grid_levels,
                r.cycles,
                r.total_profit,
                r.profit_per_cycle,
            ].join(',')
        );
    }
    return lines.join('\n') + '\n';
}

const targets = buildRange(2.5, 3, 0.1);

console.log(`Sweeping target_percent from ${targets[0]}% to ${targets.at(-1)}% (${targets.length} runs)\n`);

const results = [];
for (const t of targets) {
    const { result, grid } = await runBacktest({
        ...BASE_ARGS,
        target_percent: t,
    });

    const totalProfit = Number(result.totalProfit ?? 0);
    const cycles = Number(result.cycles ?? 0);
    const profitPerCycle = cycles > 0 ? totalProfit / cycles : 0;

    results.push({
        target_percent: t,
        grid_levels: grid?.length ?? 0,
        cycles,
        total_profit: Number(totalProfit.toFixed(2)),
        profit_per_cycle: Number(profitPerCycle.toFixed(6)),
    });

    console.log(
        `target=${t.toFixed(1)}% | profit=$${totalProfit.toFixed(2)} | cycles=${cycles} | levels=${grid?.length ?? 0}`
    );
}

// rank best first (profit desc)
results.sort((a, b) => b.total_profit - a.total_profit);

console.log('\nResults by total profit');
console.table(results);

// optional: write CSV to inspect in Excel/Sheets
fs.writeFileSync('target_range_results.csv', toCsv(results), 'utf8');
console.log('\nWrote: target_range_results.csv');