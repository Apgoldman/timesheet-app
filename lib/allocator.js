/* lib/allocator.js
   Distance-based allocation using Google Maps Distance Matrix API.
   Exports allocateTimesAcrossAddresses(entries, googleApiKey, { tz })
   entries: array of { worker, date (ISO), address, unit, start, end, totalHours, materials, notes, description }
   Returns: allocatedEntries: array normalized with start, end, totalHours, address per-row
*/
const axios = require("axios");
const { zonedTimeToUtc, utcToZonedTime } = require("date-fns-tz");
const { parse, formatISO, addMinutes } = require("date-fns");

function parseTimeToDate(dateIso, timeStr, tz) {
  // timeStr examples: "08:30", "8:30 AM", "9:00 PM"
  if (!timeStr) return null;
  try {
    // build a readable string like "2025-12-29 08:30"
    let cleaned = timeStr.replace(/\./g, "").replace(/am/i, "AM").replace(/pm/i, "PM");
    const pieces = `${dateIso} ${cleaned}`;
    const utc = zonedTimeToUtc(pieces, tz);
    return utcToZonedTime(utc, tz);
  } catch (err) {
    return null;
  }
}

function roundToNearestQuarterMinutes(minutes) {
  return Math.round(minutes / 15) * 15;
}

async function getDurationsBetweenAddresses(addresses, googleApiKey) {
  // Returns array of travel durations in minutes between consecutive addresses in the input order.
  // If API fails, returns null so caller can fallback to heuristic.
  if (!googleApiKey || !addresses || addresses.length < 2) return null;

  try {
    const durations = new Array(addresses.length - 1).fill(0);
    for (let i = 0; i < addresses.length - 1; i++) {
      const origin = addresses[i];
      const destination = addresses[i + 1];
      const url = "https://maps.googleapis.com/maps/api/distancematrix/json";
      const params = {
        origins: origin,
        destinations: destination,
        key: googleApiKey,
        units: "imperial",
      };
      const resp = await axios.get(url, { params, timeout: 10000 });
      if (resp.data && resp.data.rows && resp.data.rows[0] && resp.data.rows[0].elements && resp.data.rows[0].elements[0]) {
        const el = resp.data.rows[0].elements[0];
        if (el.status === "OK" && el.duration && el.duration.value != null) {
          durations[i] = Math.ceil(el.duration.value / 60); // seconds -> minutes
        } else {
          durations[i] = Math.round((el.duration && el.duration.value ? el.duration.value / 60 : 15));
        }
      } else {
        durations[i] = 15;
      }
    }
    return durations;
  } catch (err) {
    console.error("Distance Matrix error:", err.message || err);
    return null;
  }
}

function complexityWeight(text) {
  if (!text) return 1;
  const t = text.toLowerCase();
  const keywords = ["install", "replace", "repair", "leak", "leaking", "remove", "service", "shovel", "snow", "emergency"];
  let w = 1;
  for (const kw of keywords) if (t.includes(kw)) w += 1;
  return w;
}

function minutesToTimeStr(dateObj, tz) {
  if (!dateObj) return "";
  const hrs = dateObj.getHours().toString().padStart(2, "0");
  const mins = dateObj.getMinutes().toString().padStart(2, "0");
  return `${hrs}:${mins}`;
}

function isoDateOnly(dateIso, tz) {
  if (!dateIso) return null;
  const d = new Date(dateIso);
  return d.toISOString().slice(0, 10);
}

async function allocateTimesAcrossAddresses(entries, googleApiKey, options = {}) {
  const tz = options.tz || process.env.TZ || "America/New_York";

  // Group entries by worker+date
  const groups = {};
  for (const e of entries) {
    const worker = e.worker || "Unknown";
    const date = e.date || (e.start && e.start.split("T")[0]) || e.date;
    const key = `${worker}::${date}`;
    groups[key] = groups[key] || { worker, date, rows: [] };
    groups[key].rows.push(Object.assign({}, e));
  }

  const out = [];

  for (const key of Object.keys(groups)) {
    const group = groups[key];
    const rows = group.rows;
    // compute if we already have per-row hours
    const rowsWithHours = rows.filter(r => r.totalHours || (r.start && r.end));
    if (rowsWithHours.length === rows.length) {
      // compute any missing totalHours from start/end and normalize
      for (const r of rows) {
        if (!r.totalHours && r.start && r.end) {
          try {
            const startDt = parseTimeToDate(group.date, r.start, tz);
            const endDt = parseTimeToDate(group.date, r.end, tz);
            let minutes = Math.round((endDt - startDt) / 60000);
            minutes = roundToNearestQuarterMinutes(minutes);
            r.totalHours = Math.max(0, minutes / 60);
          } catch (err) {
            r.totalHours = 0;
          }
        }
        out.push(r);
      }
      continue;
    }

    // Determine day total hours
    let dayTotal = null;
    const totals = Array.from(new Set(rows.map(r => (r.totalHours ? Number(r.totalHours) : null)).filter(Boolean)));
    if (totals.length === 1) {
      dayTotal = totals[0];
    } else {
      const sumKnown = rows.reduce((s, r) => s + (r.totalHours ? Number(r.totalHours) : 0), 0);
      if (sumKnown > 0) {
        dayTotal = sumKnown;
      }
    }

    if (dayTotal == null) {
      for (const r of rows) {
        if (r.notes && /total|day total|total hours/i.test(r.notes) && r.totalHours) {
          dayTotal = Number(r.totalHours);
          break;
        }
      }
    }

    if (dayTotal == null) {
      const computed = rows.map(r => {
        if (r.start && r.end) {
          const sd = parseTimeToDate(group.date, r.start, tz);
          const ed = parseTimeToDate(group.date, r.end, tz);
          if (sd && ed) {
            const m = roundToNearestQuarterMinutes(Math.round((ed - sd) / 60000));
            return m / 60;
          }
        }
        return 0;
      });
      const s = computed.reduce((a, b) => a + b, 0);
      if (s > 0) {
        for (let i = 0; i < rows.length; i++) {
          if (!rows[i].totalHours && rows[i].start && rows[i].end) {
            rows[i].totalHours = computed[i];
          }
          out.push(rows[i]);
        }
        continue;
      }
      dayTotal = 8;
    }

    // Allocate dayTotal across rows that lack totalHours
    const addrRows = rows.map(r => ({ ...r }));
    const targets = addrRows.filter(r => !r.totalHours);
    const fixed = addrRows.filter(r => r.totalHours);

    const knownSum = fixed.reduce((s, r) => s + Number(r.totalHours || 0), 0);
    let remainder = Math.max(0, dayTotal - knownSum);

    const addresses = targets.map(r => r.address || r.notes || r.description || "Unknown");
    let travelDurations = null;
    try {
      travelDurations = await getDurationsBetweenAddresses(addresses, googleApiKey);
    } catch (err) {
      travelDurations = null;
    }

    let totalTravelMinutes = 0;
    if (travelDurations && travelDurations.length) {
      totalTravelMinutes = travelDurations.reduce((a, b) => a + b, 0);
    } else {
      totalTravelMinutes = Math.max(0, (targets.length - 1) * 15);
    }

    let availableMinutes = Math.round(remainder * 60) - totalTravelMinutes;
    if (availableMinutes < 0) {
      availableMinutes = Math.max(0, Math.round(remainder * 60) - totalTravelMinutes);
    }

    const weights = targets.map(t => complexityWeight(`${t.description || ""} ${t.notes || ""} ${t.address || ""}`));
    const weightSum = weights.reduce((a, b) => a + b, 0) || targets.length;

    const serviceMinutesByTarget = targets.map((t, idx) => {
      const share = Math.round((weights[idx] / weightSum) * Math.max(0, availableMinutes));
      return share;
    });

    const travelByTarget = targets.map((t, idx) => {
      if (idx < (travelDurations ? travelDurations.length : targets.length - 1)) {
        const tm = travelDurations ? travelDurations[idx] : 15;
        return tm;
      }
      return 0;
    });

    let dayStart = null;
    const fixedStarts = fixed.map(r => parseTimeToDate(group.date, r.start, tz)).filter(Boolean);
    if (fixedStarts.length) {
      dayStart = fixedStarts.reduce((a, b) => (a < b ? a : b));
    } else {
      dayStart = new Date(group.date + "T08:00:00.000Z");
    }

    let current = roundToNearestQuarterMinutes((dayStart.getUTCHours() * 60) + dayStart.getUTCMinutes());
    for (let i = 0; i < targets.length; i++) {
      const serv = serviceMinutesByTarget[i] || Math.round((availableMinutes / Math.max(1, targets.length)));
      const travel = travelByTarget[i] || 0;
      const startMinutes = current;
      const endMinutes = startMinutes + serv;
      targets[i].totalHours = Math.round((endMinutes - startMinutes) / 15) * 15 / 60;
      const startDate = addMinutes(new Date(group.date + "T00:00:00.000Z"), startMinutes);
      const endDate = addMinutes(new Date(group.date + "T00:00:00.000Z"), endMinutes);
      targets[i].start = minutesToTimeStr(startDate, tz);
      targets[i].end = minutesToTimeStr(endDate, tz);
      current = endMinutes + travel;
      current = roundToNearestQuarterMinutes(current);
    }

    for (const r of fixed) out.push(r);
    for (const r of targets) out.push(r);
  }

  return out;
}

module.exports = {
  allocateTimesAcrossAddresses,
};
