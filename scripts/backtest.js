import { runBacktest } from '../src/backtest/runBacktest.js';
import { FEE_RATE_MAKER_PER_SIDE } from '../src/functions/init.js';

const { result, grid } = await runBacktest({
  symbol: 'BTCUSDT',
  interval: '1m', // Needs to be 1 minute, always otherwise you might miss profits.
  startDate: '01/12/2025',
  endDate: '01/02/2026',
  entry_price: 62000,
  exit_price: 102000,
  margin_percent: 0.1,
  target_percent: 1.8,
  simulationConfig: {
    baseUsdPerOrder: 100,
    feeRatePerSide: FEE_RATE_MAKER_PER_SIDE,
    enableLogs: true,
  },
});

console.log('BACKTEST RESULT');
console.log('=========================================');
console.log(`Symbol: BTCUSDT`);
console.log(`Grid Levels: ${grid.length}`);
console.log(`Total Cycles: ${result.cycles}`);
console.log(`Total Profit: $${result.totalProfit.toFixed(2)}`);
console.log('=========================================');