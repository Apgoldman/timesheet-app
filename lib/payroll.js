/* lib/payroll.js
   Compute worker pay per row using rates and weekend rules.
   Exports computePayForRow(row, tz)
*/
const { utcToZonedTime } = require("date-fns-tz");
const { parseISO, getDay } = require("date-fns");

const RATES = {
  "Jose": 25,
  "José": 25,
  "Myer": 20,
  "Damian": 30,
  "Chris": 30
};

function isWeekend(dateIso, tz) {
  if (!dateIso) return false;
  try {
    const d = utcToZonedTime(parseISO(dateIso), tz || process.env.TZ || "America/New_York");
    const day = d.getDay(); // 0=Sun,6=Sat
    return day === 0 || day === 6;
  } catch (err) {
    return false;
  }
}

function computePayForRow(row, tz) {
  const worker = row.worker || "";
  const rate = RATES[worker] || 0;
  const hours = Number(row.totalHours || 0);
  const weekend = isWeekend(row.date, tz);
  let pay = 0;
  if (weekend) {
    if (["Jose", "José", "Chris", "Damian"].includes(worker)) {
      pay = hours * rate * 1.5;
    } else {
      pay = hours * rate;
    }
  } else {
    pay = hours * rate;
  }
  return Math.round(pay * 100) / 100;
}

module.exports = { computePayForRow, RATES };
