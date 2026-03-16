// datePeriods.js
import { DateTime } from 'luxon';

let _tz = 'America/Edmonton';
export function setDatePeriodsTimezone(tz) { _tz = tz || 'America/Edmonton'; }

function now() {
  return DateTime.now().setZone(_tz);
}

function ymd(dt) {
  return dt.toFormat('yyyy-LL-dd');
}

function startOfWeekMonday(ref) {
  // Luxon: Monday=1 ... Sunday=7
  const weekday = ref.weekday;
  const diff = weekday - 1;
  return ref.minus({ days: diff }).startOf('day');
}

function periodDay(ref = now()) {
  const d = ref.startOf('day');
  return {
    key: 'day',
    label: `Today (${ymd(d)})`,
    from: ymd(d),
    to: ymd(d),
  };
}

function periodPreviousDay(ref = now()) {
  const d = ref.minus({ days: 1 }).startOf('day');
  return {
    key: 'previous_day',
    label: `Previous day (${ymd(d)})`,
    from: ymd(d),
    to: ymd(d),
  };
}

function periodWeek(ref = now()) {
  const startLocal = startOfWeekMonday(ref);
  const endLocal = startLocal.plus({ days: 6 }); // inclusive
  return {
    key: 'week',
    label: `This week (${ymd(startLocal)} → ${ymd(endLocal)})`,
    from: ymd(startLocal),
    to: ymd(endLocal),
  };
}

function periodPreviousWeek(ref = now()) {
  const startLocal = startOfWeekMonday(ref.minus({ weeks: 1 }));
  const endLocal = startLocal.plus({ days: 6 }); // inclusive
  return {
    key: 'previous_week',
    label: `Previous week (${ymd(startLocal)} → ${ymd(endLocal)})`,
    from: ymd(startLocal),
    to: ymd(endLocal),
  };
}

function periodMonth(ref = now()) {
  const startLocal = ref.startOf('month');
  const endLocal = startLocal.plus({ months: 1 }).minus({ days: 1 }); // inclusive last day
  return {
    key: 'month',
    label: `This month (${startLocal.toFormat('LLLL yyyy')})`,
    from: ymd(startLocal),
    to: ymd(endLocal),
  };
}

function periodPreviousMonth(ref = now()) {
  const d = ref.minus({ months: 1 });
  const startLocal = d.startOf('month');
  const endLocal = startLocal.plus({ months: 1 }).minus({ days: 1 }); // inclusive last day
  return {
    key: 'previous_month',
    label: `Previous month (${startLocal.toFormat('LLLL yyyy')})`,
    from: ymd(startLocal),
    to: ymd(endLocal),
  };
}

function periodYear(ref = now()) {
  const startLocal = ref.startOf('year');
  const endLocal = ref.startOf('day'); // year-to-date (today)
  return {
    key: 'year',
    label: `Year-to-date (${startLocal.toFormat('yyyy')})`,
    from: ymd(startLocal),
    to: ymd(endLocal),
  };
}

function periodMonthToDate(ref = now()) {
  const startLocal = ref.startOf('month');
  const endLocal = ref.startOf('day'); // today
  return {
    key: 'month_to_date',
    label: `Month-to-date (${startLocal.toFormat('LLLL yyyy')})`,
    from: ymd(startLocal),
    to: ymd(endLocal),
    meta: {
      dayOfMonth: ref.day,
      daysInMonth: ref.daysInMonth,
    },
  };
}

export {
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