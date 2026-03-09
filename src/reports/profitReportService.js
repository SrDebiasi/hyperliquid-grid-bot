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
import {calcExposureFromOrders} from "./exposureService.js";
import {fetchHyperliquidMidFromPair, retrieveConfig, retrieveOrders, retrieveTradeProfit} from "../functions/functions.js";

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

function groupProfitByDay(rows, timezone, from, to) {
    const list = Array.isArray(rows) ? rows : [];
    const map = new Map(); // ymd -> { totalUsd, trades }

    for (const r of list) {
        const v = Number(r?.value || 0);
        const dt = parseRowDateTime(r, timezone);
        const day = dt ? dt.toFormat('yyyy-LL-dd') : null;
        if (!day) continue;

        const cur = map.get(day) || { totalUsd: 0, trades: 0 };
        cur.totalUsd += v;
        cur.trades += 1;
        map.set(day, cur);
    }

    // fallback to old behavior if range was not provided
    if (!from || !to) {
        const days = Array.from(map.entries())
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([date, v]) => ({
                date,
                totalUsd: v.totalUsd,
                trades: v.trades,
            }))
            .reverse();

        const totalUsd = days.reduce((acc, d) => acc + d.totalUsd, 0);
        const trades = days.reduce((acc, d) => acc + d.trades, 0);

        return { days, totalUsd, trades };
    }

    const start = DateTime.fromFormat(String(from), 'yyyy-LL-dd', { zone: timezone });
    const end = DateTime.fromFormat(String(to), 'yyyy-LL-dd', { zone: timezone });

    if (!start.isValid || !end.isValid) {
        const days = Array.from(map.entries())
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([date, v]) => ({
                date,
                totalUsd: v.totalUsd,
                trades: v.trades,
            }))
            .reverse();

        const totalUsd = days.reduce((acc, d) => acc + d.totalUsd, 0);
        const trades = days.reduce((acc, d) => acc + d.trades, 0);

        return { days, totalUsd, trades };
    }

    const days = [];
    const totalDays = Math.floor(end.diff(start, 'days').days);

    for (let i = 0; i <= totalDays; i += 1) {
        const current = start.plus({ days: i });
        const key = current.toFormat('yyyy-LL-dd');
        const value = map.get(key) || { totalUsd: 0, trades: 0 };

        days.push({
            date: key,
            totalUsd: value.totalUsd,
            trades: value.trades,
        });
    }

    days.reverse();

    const totalUsd = days.reduce((acc, d) => acc + d.totalUsd, 0);
    const trades = days.reduce((acc, d) => acc + d.trades, 0);

    return { days, totalUsd, trades };
}

async function buildTotalsForPeriod({ tradeInstanceId, periodFn }) {
    const period = periodFn();
    const rows = await retrieveTradeProfit({
        trade_instance_id: tradeInstanceId,
        date_start: period.from,
        date_end: period.to,
    });

    const plain = toPlainRows(rows);

    const { totalUsd, trades } = sumProfit(plain);
    return {
        period: { key: period.key, label: period.label, from: period.from, to: period.to, timezone: period.timezone },
        totalUsd,
        trades,
    };
}

async function buildAllTimeTotals({ tradeInstanceId }) {
    const rows = await retrieveTradeProfit({
        trade_instance_id: tradeInstanceId
    });
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
    const rows = await retrieveTradeProfit({
        trade_instance_id: tradeInstanceId,
        date_start: period.from,
        date_end: period.to,
    });
    const plain = toPlainRows(rows);

    const grouped = groupProfitByDay(
        plain,
        period.timezone,
        period.from,
        period.to,
    );

    return {
        period: {
            key: period.key,
            label: period.label,
            from: period.from,
            to: period.to,
            timezone: period.timezone,
        },
        days: grouped.days,
        totalUsd: grouped.totalUsd,
        trades: grouped.trades,
    };
}

function pnlPercent(totalUsd, exposureUsd) {
    const exp = Number(exposureUsd || 0);
    if (!exp) return null;
    return (Number(totalUsd || 0) / exp) * 100;
}


async function buildExposureNow({ tradeInstanceId }) {
    // config
    let cfg = await retrieveConfig({ trade_instance_id: tradeInstanceId });
    cfg = cfg?.[0];
    if (!cfg?.pair) return null;

    // price
    const currentPrice = await fetchHyperliquidMidFromPair(cfg.pair);

    // orders
    const orders =
        (await retrieveOrders({ pair: cfg.pair, trade_instance_id: tradeInstanceId })) || [];

    return calcExposureFromOrders(orders, currentPrice);
}

async function getProfitSummary({ models, tradeInstanceId }) {
    const [today, week, month, year, allTime, dailyProfitMtd, exposure] = await Promise.all([
        buildTotalsForPeriod({ tradeInstanceId, periodFn: periodDay }),
        buildTotalsForPeriod({ tradeInstanceId, periodFn: periodWeek }),
        buildTotalsForPeriod({ tradeInstanceId, periodFn: periodMonth }),
        buildTotalsForPeriod({ tradeInstanceId, periodFn: periodYear }),
        buildAllTimeTotals({  tradeInstanceId }),
        buildDailyProfitMtd({  tradeInstanceId }),
        buildExposureNow({ tradeInstanceId }),
    ]);

    const exposureUsd = exposure?.totalExposureUsd ?? null;

    const totals = { today, week, month, year, allTime };
    for (const k of Object.keys(totals)) {
        totals[k].pnlPercent = pnlPercent(totals[k].totalUsd, exposureUsd);
    }

    return {
        exposure: exposure
            ? {
                totalExposureUsd: exposure.totalExposureUsd,
                coinQty: exposure.coinQty,
                reservedUsd: exposure.reservedUsd,
            }
            : null,
        totals,
        dailyProfitMtd,
    };
};

export {
    getProfitSummary,
    sumProfit,
    groupProfitByDay,
    parseRowDateTime,
};
