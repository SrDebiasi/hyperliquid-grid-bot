// datePeriods.js
import { DateTime } from 'luxon';

const BOT_TZ = process.env.BOT_TZ || 'America/Edmonton'; // Calgary default

function now() {
  return DateTime.now().setZone(BOT_TZ);
}

function ymd(dt) {
  return dt.toFormat('yyyy-LL-dd'); // YYYY-MM-DD
}

function periodDay(ref = now()) {
  const start = ref.startOf('day');
  const end = ref.endOf('day');
  return {
    key: 'day',
    label: `Today (${ymd(ref)})`,
    from: ymd(start),
    to: ymd(end),
  };
}

function periodPreviousDay(ref = now()) {
  const d = ref.minus({ days: 1 });
  return {
    key: 'previous_day',
    label: `Previous day (${ymd(d)})`,
    timezone: BOT_TZ,
    from: ymd(d.startOf('day')),
    to: ymd(d.endOf('day')),
  };
}

// Luxon normalmente considera week começando na Monday dependendo do locale.
// Pra garantir Monday, calculamos manualmente.
function startOfWeekMonday(ref) {
  // Luxon: Monday=1 ... Sunday=7
  const weekday = ref.weekday;
  const diff = weekday - 1; // dias desde Monday
  return ref.minus({ days: diff }).startOf('day');
}

function endOfWeekSunday(ref) {
  const start = startOfWeekMonday(ref);
  return start.plus({ days: 6 }).endOf('day');
}

function periodWeek(ref = now()) {
  const start = startOfWeekMonday(ref);
  const end = endOfWeekSunday(ref);
  return {
    key: 'week',
    label: `This week (${ymd(start)} → ${ymd(end)})`,
    timezone: BOT_TZ,
    from: ymd(start),
    to: ymd(end),
  };
}

function periodPreviousWeek(ref = now()) {
  const lastWeekRef = ref.minus({ weeks: 1 });
  const start = startOfWeekMonday(lastWeekRef);
  const end = endOfWeekSunday(lastWeekRef);
  return {
    key: 'previous_week',
    label: `Previous week (${ymd(start)} → ${ymd(end)})`,
    timezone: BOT_TZ,
    from: ymd(start),
    to: ymd(end),
  };
}

function periodMonth(ref = now()) {
  const start = ref.startOf('month');
  const end = ref.endOf('month');

  return {
    key: 'month',
    label: `This month (${ref.toFormat('LLLL yyyy')})`,
    timezone: BOT_TZ,
    from: ymd(start),
    to: ymd(end),
  };
}

function periodYear(ref = now()) {
  const start = ref.startOf('year');
  const end = ref.endOf('year');

  return {
    key: 'year',
    label: `Year-to-date (${ref.toFormat('yyyy')})`,
    timezone: BOT_TZ,
    from: ymd(start),
    to: ymd(end),
  };
}

function periodPreviousMonth(ref = now()) {
  const d = ref.minus({ months: 1 });
  const start = d.startOf('month');
  const end = d.endOf('month');
  return {
    key: 'previous_month',
    label: `Previous month (${d.toFormat('LLLL yyyy')})`,
    timezone: BOT_TZ,
    from: ymd(start),
    to: ymd(end),
  };
}

// Mês até hoje (pra estimate)
function periodMonthToDate(ref = now()) {
  const start = ref.startOf('month');
  return {
    key: 'month_to_date',
    label: `Month-to-date (${ref.toFormat('LLLL yyyy')})`,
    timezone: BOT_TZ,
    from: ymd(start),
    to: ymd(ref),
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
