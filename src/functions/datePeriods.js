// datePeriods.js
import { DateTime } from 'luxon';

const BOT_TZ = process.env.BOT_TZ || 'America/Edmonton'; // Calgary default

function now() {
  return DateTime.now().setZone(BOT_TZ);
}

function ymd(dt) {
  return dt.toFormat('yyyy-LL-dd');
}

function toUtcJsDate(dt) {
  return dt.toUTC().toJSDate();
}

function withUtcBounds({ startLocal, endLocalExclusive, ...rest }) {
  return {
    ...rest,
    timezone: BOT_TZ,

    // For DB filtering (UTC instants)
    fromUtc: toUtcJsDate(startLocal),
    toUtc: toUtcJsDate(endLocalExclusive),

    // For display/range text (date-only)
    from: ymd(startLocal),
    to: ymd(endLocalExclusive.minus({ milliseconds: 1 })),
  };
}

function periodDay(ref = now()) {
  const startLocal = ref.startOf('day');
  const endLocalExclusive = startLocal.plus({ days: 1 });

  return withUtcBounds({
    key: 'day',
    label: `Today (${ymd(startLocal)})`,
    startLocal,
    endLocalExclusive,
  });
}

function periodPreviousDay(ref = now()) {
  const startLocal = ref.minus({ days: 1 }).startOf('day');
  const endLocalExclusive = startLocal.plus({ days: 1 });

  return withUtcBounds({
    key: 'previous_day',
    label: `Previous day (${ymd(startLocal)})`,
    startLocal,
    endLocalExclusive,
  });
}

function startOfWeekMonday(ref) {
  // Luxon: Monday=1 ... Sunday=7
  const weekday = ref.weekday;
  const diff = weekday - 1;
  return ref.minus({ days: diff }).startOf('day');
}

function periodWeek(ref = now()) {
  const startLocal = startOfWeekMonday(ref);
  const endLocalExclusive = startLocal.plus({ days: 7 });

  return withUtcBounds({
    key: 'week',
    label: `This week (${ymd(startLocal)} → ${ymd(endLocalExclusive.minus({ days: 1 }))})`,
    startLocal,
    endLocalExclusive,
  });
}

function periodPreviousWeek(ref = now()) {
  const startLocal = startOfWeekMonday(ref.minus({ weeks: 1 }));
  const endLocalExclusive = startLocal.plus({ days: 7 });

  return withUtcBounds({
    key: 'previous_week',
    label: `Previous week (${ymd(startLocal)} → ${ymd(endLocalExclusive.minus({ days: 1 }))})`,
    startLocal,
    endLocalExclusive,
  });
}

function periodMonth(ref = now()) {
  const startLocal = ref.startOf('month');
  const endLocalExclusive = startLocal.plus({ months: 1 });

  return withUtcBounds({
    key: 'month',
    label: `This month (${startLocal.toFormat('LLLL yyyy')})`,
    startLocal,
    endLocalExclusive,
  });
}

function periodPreviousMonth(ref = now()) {
  const d = ref.minus({ months: 1 });
  const startLocal = d.startOf('month');
  const endLocalExclusive = startLocal.plus({ months: 1 });

  return withUtcBounds({
    key: 'previous_month',
    label: `Previous month (${startLocal.toFormat('LLLL yyyy')})`,
    startLocal,
    endLocalExclusive,
  });
}

function periodYear(ref = now()) {
  const startLocal = ref.startOf('year');
  const endLocalExclusive = startLocal.plus({ years: 1 });

  return withUtcBounds({
    key: 'year',
    label: `Year-to-date (${startLocal.toFormat('yyyy')})`,
    startLocal,
    endLocalExclusive,
  });
}

function periodMonthToDate(ref = now()) {
  const startLocal = ref.startOf('month');
  const endLocalExclusive = ref.plus({ days: 1 }).startOf('day'); // end-exclusive (next midnight)

  return {
    ...withUtcBounds({
      key: 'month_to_date',
      label: `Month-to-date (${startLocal.toFormat('LLLL yyyy')})`,
      startLocal,
      endLocalExclusive,
    }),

    meta: {
      dayOfMonth: ref.day,
      daysInMonth: ref.daysInMonth,
    },
  };
}

export {
  BOT_TZ,
  now,
  ymd,
  periodDay,
  periodPreviousDay,
  periodWeek,
  periodPreviousWeek,
  periodMonth,
  periodPreviousMonth,
  periodYear,
  periodMonthToDate,
};