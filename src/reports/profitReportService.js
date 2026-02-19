// src/reports/profitReportService.js
import { DateTime } from 'luxon';
import {
    periodDay,
    periodWeek,
    periodMonth,
    periodYear,
    periodMonthToDate,
    now,
} from '../functions/datePeriods.js';
import {
    findAllProfitRows,
    findProfitRowsForPeriod,
} from './profitRepo.js';

function toPlainRows(rows) {
    return (rows || []).map(r => (r?.get ? r.get({ plain: true }) : r));
}

function sumProfit(rows) {
    const list = Array.isArray(rows) ? rows : [];
    const totalUsd = list.reduce((acc, r) => acc + Number(r?.value || 0), 0);
    return { totalUsd, trades: list.length };
}

function parseRowDateTime(row, timezone) {
    const raw =
        row?.date_transaction ??
        row?.date ??
        row?.created_at ??
        row?.updated_at ??
        null;

    if (!raw) return null;

    if (raw instanceof Date) {
        const dt = DateTime.fromJSDate(raw, { zone: timezone });
        return dt.isValid ? dt : null;
    }

    const s = String(raw).trim();

    // "YYYY-MM-DD HH:mm:ss(.xxxxxx)" safe parsing
    const noMicros = s.replace(/\.\d{1,6}$/, '');
    let dt = DateTime.fromFormat(noMicros, 'yyyy-LL-dd HH:mm:ss', { zone: timezone });
    if (dt.isValid) return dt;

    dt = DateTime.fromSQL(noMicros, { zone: timezone });
    if (dt.isValid) return dt;

    dt = DateTime.fromISO(s, { zone: timezone });
    if (dt.isValid) return dt;

    const js = new Date(s);
    if (!Number.isNaN(js.getTime())) {
        dt = DateTime.fromJSDate(js, { zone: timezone });
        return dt.isValid ? dt : null;
    }

    return null;
}

function groupProfitByDay(rows, timezone) {
    const list = Array.isArray(rows) ? rows : [];
    const map = new Map(); // ymd -> { totalUsd, trades }

    for (const r of list) {
        const v = Number(r?.value || 0);
        const dt = parseRowDateTime(r, timezone);
        const day = dt ? dt.toFormat('yyyy-LL-dd') : 'unknown';

        const cur = map.get(day) || { totalUsd: 0, trades: 0 };
        cur.totalUsd += v;
        cur.trades += 1;
        map.set(day, cur);
    }

    const days = Array.from(map.entries())
        .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
        .map(([date, v]) => ({ date, totalUsd: v.totalUsd, trades: v.trades }));

    const totalUsd = days.reduce((acc, d) => acc + d.totalUsd, 0);
    const trades = days.reduce((acc, d) => acc + d.trades, 0);

    return { days, totalUsd, trades };
}

async function buildTotalsForPeriod({ models, tradeInstanceId, periodFn }) {
    const period = periodFn();
    const rows = await findProfitRowsForPeriod({ models, tradeInstanceId, period });
    const plain = toPlainRows(rows);

    const { totalUsd, trades } = sumProfit(plain);
    return {
        period: { key: period.key, label: period.label, from: period.from, to: period.to, timezone: period.timezone },
        totalUsd,
        trades,
    };
}

async function buildAllTimeTotals({ models, tradeInstanceId }) {
    const rows = await findAllProfitRows({ models, tradeInstanceId });
    const plain = toPlainRows(rows);

    const { totalUsd, trades } = sumProfit(plain);

    // infer range for display
    const tz = (periodMonthToDate().timezone); // from datePeriods.js
    const firstDt = plain.length ? parseRowDateTime(plain[0], tz) : null;
    const lastDt = plain.length ? parseRowDateTime(plain[plain.length - 1], tz) : null;

    return {
        period: {
            key: 'all_time',
            label: 'All-time',
            from: firstDt ? firstDt.toFormat('yyyy-LL-dd') : null,
            to: lastDt ? lastDt.toFormat('yyyy-LL-dd') : DateTime.fromJSDate(now().toJSDate(), { zone: tz }).toFormat('yyyy-LL-dd'),
            timezone: tz,
        },
        totalUsd,
        trades,
    };
}

async function buildDailyProfitMtd({ models, tradeInstanceId }) {
    const period = periodMonthToDate();
    const rows = await findProfitRowsForPeriod({ models, tradeInstanceId, period });
    const plain = toPlainRows(rows);

    const grouped = groupProfitByDay(plain, period.timezone);

    return {
        period: { key: period.key, label: period.label, from: period.from, to: period.to, timezone: period.timezone },
        days: grouped.days,
        totalUsd: grouped.totalUsd,
        trades: grouped.trades,
    };
}

async function getProfitSummary({ models, tradeInstanceId }) {
    const [today, week, month, year, allTime, dailyProfitMtd] = await Promise.all([
        buildTotalsForPeriod({ models, tradeInstanceId, periodFn: periodDay }),
        buildTotalsForPeriod({ models, tradeInstanceId, periodFn: periodWeek }),
        buildTotalsForPeriod({ models, tradeInstanceId, periodFn: periodMonth }),
        buildTotalsForPeriod({ models, tradeInstanceId, periodFn: periodYear }),
        buildAllTimeTotals({ models, tradeInstanceId }),
        buildDailyProfitMtd({ models, tradeInstanceId }),
    ]);

    return {
        totals: { today, week, month, year, allTime },
        dailyProfitMtd,
    };
}

export {
    getProfitSummary,
    // exporting these is useful later for Telegram refactor
    sumProfit,
    groupProfitByDay,
    parseRowDateTime,
};
