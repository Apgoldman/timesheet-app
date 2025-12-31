/* lib/parser.js
   Improved heuristics:
   - Map weekday names to the nearest past/this-week ISO date when no explicit date is present.
   - Prefer $-prefixed money values; fallback to keyword-scoped amounts (gas, materials, helper).
   - Avoid matching time components as money.
   - Compute totalHours when start/end are present and round to nearest 15 minutes.
*/
const WORKERS = ["Jose","José","Damian","Chris","Myer"];

const WEEKDAYS = {
  sunday:0, monday:1, tuesday:2, wednesday:3, thursday:4, friday:5, saturday:6,
  sun:0, mon:1, tue:2, wed:3, thu:4, fri:5, sat:6
};

function findWorker(line) {
  for (const w of WORKERS) {
    const r = new RegExp('\\b' + w + '\\b','i');
    if (r.test(line)) return w;
  }
  return null;
}

function parseMmDdToIso(match) {
  const parts = match.split(/[\/\-]/).map(p=>p.trim());
  let mm = parts[0].padStart(2,'0'), dd = parts[1].padStart(2,'0'), yy = parts[2];
  if (!yy) {
    const y = new Date().getFullYear();
    yy = String(y);
  } else if (yy.length === 2) {
    yy = '20' + yy;
  }
  return `${yy}-${mm}-${dd}`;
}

function findDate(line) {
  if (!line) return null;
  // mm/dd or mm-dd
  const m1 = line.match(/(\b\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})\b)/);
  if (m1) return parseMmDdToIso(m1[1]);

  // Month name like "Dec 11" or "December 11"
  const m2 = line.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:,?\s*(\d{4}))?/i);
  if (m2) {
    const months = {jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12};
    const mm = String(months[m2[1].slice(0,3).toLowerCase()]).padStart(2,'0');
    const dd = String(m2[2]).padStart(2,'0');
    const yy = m2[3] || String(new Date().getFullYear());
    return `${yy}-${mm}-${dd}`;
  }

  // Weekday words
  const wd = line.match(/\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|wed|thu|fri|sat)\b/i);
  if (wd) {
    return isoForWeekday(wd[1]);
  }

  return null;
}

function isoForWeekday(name) {
  // Map a weekday name to the most recent date (<= today) that matches that weekday.
  const key = name.toLowerCase().slice(0,3);
  const target = WEEKDAYS[key];
  if (target == null) return null;
  const today = new Date();
  // Use local date (no timezone conversion). Find the most recent target weekday <= today.
  const todayDay = today.getDay(); // 0..6
  let diff = todayDay - target;
  if (diff < 0) diff += 7;
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - diff);
  return d.toISOString().slice(0,10);
}

function findTimes(line) {
  if (!line) return null;
  // look for "9:00 AM - 5:30 PM" variations
  const m = line.match(/(\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)?)\s*[–—\-to]{1,3}\s*(\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)?)/);
  if (m) {
    return { start: normalizeTime(m[1]), end: normalizeTime(m[2]) };
  }
  // "Hours: 9:00 AM – 5:30 PM"
  const m2 = line.match(/hours[:\s]*([\d:]{1,5}\s*(?:AM|PM|am|pm)?)\s*[–—\-to]{1,3}\s*([\d:]{1,5}\s*(?:AM|PM|am|pm)?)/i);
  if (m2) return { start: normalizeTime(m2[1]), end: normalizeTime(m2[2]) };
  // "start at 10" and "stop at 2"
  const ms = line.match(/start(?:ed)?\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(AM|PM|am|pm)?/);
  const me = line.match(/stop(?:ped)?\s*(?:at)?\s+(\d{1,2})(?::(\d{2}))?\s*(AM|PM|am|pm)?/);
  if (ms && me) {
    const s = ms[1].padStart(2,'0') + ':' + (ms[2] || '00') + (ms[3] ? ' ' + ms[3] : '');
    const e = me[1].padStart(2,'0') + ':' + (me[2] || '00') + (me[3] ? ' ' + me[3] : '');
    return { start: normalizeTime(s), end: normalizeTime(e) };
  }
  return null;
}

function normalizeTime(ts) {
  if (!ts) return null;
  let t = ts.trim().replace(/\./g,'');
  // ensure "HH:MM" or "H:MM AM"
  const m = t.match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM|am|pm)?/);
  if (!m) return t;
  let hh = parseInt(m[1],10);
  const mm = m[2] ? parseInt(m[2],10) : 0;
  const ampm = m[3];
  if (ampm) {
    const pm = /pm/i.test(ampm);
    if (pm && hh < 12) hh += 12;
    if (!pm && hh === 12) hh = 0;
  }
  return String(hh).padStart(2,'0') + ':' + String(mm).padStart(2,'0');
}

function parseTimeToMinutes(timeStr) {
  if (!timeStr) return null;
  const m = timeStr.match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return parseInt(m[1],10) * 60 + parseInt(m[2],10);
}

function roundToNearestQuarterMinutes(minutes) {
  return Math.round(minutes / 15) * 15;
}

function findMoney(line) {
  if (!line) return null;
  // prefer $-prefixed amounts
  const mDollar = line.match(/\$\s*([0-9]+(?:\.[0-9]{1,2})?)/);
  if (mDollar) return parseFloat(mDollar[1]);

  // look for words like "gas" or "materials" followed by a number (allow $ or not)
  const mKeyword = line.match(/(?:gas|materials|material|helper|paid|cost|charge)[:\s]*\$?\s*([0-9]+(?:\.[0-9]{1,2})?)/i);
  if (mKeyword) return parseFloat(mKeyword[1]);

  // avoid matching times (e.g., 9:00) or job numbers; if a standalone number appears, ignore it
  return null;
}

function findHelperHours(line) {
  if (!line) return null;
  const m = line.match(/helper\s*(?:[:\-]?\s*)?(\d+(?:\.\d+)?)\s*(?:hrs|hours|hr)?/i);
  if (m) return parseFloat(m[1]);
  return null;
}

function findAddress(line) {
  if (!line) return null;
  // heuristic: lines that contain a number + street keyword
  if (/\d{1,4}\s+[A-Za-z0-9\.\-]+\s+(St|Street|Ave|Avenue|Rd|Road|Blvd|Drive|Dr|Market|Spring|Lane|Ln|Court|Ct|Way)/i.test(line)) {
    return line.trim();
  }
  const m = line.match(/jobs[:\s]*\s*(\d+\s+[A-Za-z0-9\.\- ]+)/i);
  if (m) return m[1].trim();
  // fallback: if the line contains a city-like token and digits, return line
  if (/\d+/.test(line) && /[A-Za-z]/.test(line)) return line.trim();
  return null;
}

function computeHoursFromTimes(start, end) {
  const s = parseTimeToMinutes(start);
  const e = parseTimeToMinutes(end);
  if (s == null || e == null) return 0;
  let minutes = e - s;
  if (minutes < 0) minutes += 24 * 60; // handle past-midnight
  minutes = roundToNearestQuarterMinutes(minutes);
  return Math.round((minutes / 60) * 100) / 100;
}

function parseTextToEntries(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const entries = [];
  let current = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const worker = findWorker(line);
    const date = findDate(line);
    const times = findTimes(line);
    const money = findMoney(line);
    const helperH = findHelperHours(line);
    const address = findAddress(line);

    if (worker && line.includes(':')) {
      if (current) entries.push(current);
      current = { worker: worker, date: date || null, address: address || null, start: null, end: null, totalHours: null, materials: null, notes: '' };
      if (times) { current.start = times.start; current.end = times.end; }
      if (money) current.materials = money;
      if (helperH) current.notes += `helper ${helperH}hrs. `;
      const after = line.split(':').slice(1).join(':').trim();
      if (after) current.notes += after + ' ';
      continue;
    }

    if (!current && times) {
      current = { worker: null, date: date || null, address: address || null, start: times.start, end: times.end, totalHours: null, materials: null, notes: '' };
      continue;
    }

    if (current) {
      if (!current.date && date) current.date = date;
      if (!current.address && address) current.address = address;
      if (!current.start && times) { current.start = times.start; current.end = times.end; }
      if (!current.materials && money) current.materials = money;
      if (helperH) current.notes += `helper ${helperH}hrs. `;
      current.notes += line + ' ';
    } else {
      if (worker || address || date || times || money) {
        current = { worker: worker || null, date: date || null, address: address || null, start: times ? times.start : null, end: times ? times.end : null, totalHours: null, materials: money || null, notes: line };
      }
    }
  }

  if (current) entries.push(current);

  // Post-process entries: fill missing date from weekday in notes, compute hours from times, prefer $ amounts, attach helper money to materials
  for (const e of entries) {
    // if notes contain weekday mention and date missing, derive date
    if (!e.date && e.notes) {
      const wd = e.notes.match(/\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|wed|thu|fri|sat)\b/i);
      if (wd) e.date = isoForWeekday(wd[1]);
    }

    // If still no date but we have times, use today's date as fallback (so we can compute hours)
    if (!e.date && e.start && e.end) {
      e.date = new Date().toISOString().slice(0,10);
    }

    // materials: prefer $-prefixed amounts inside notes if not already set
    if (!e.materials && e.notes) {
      const m = findMoney(e.notes);
      if (m) e.materials = m;
    }

    // helper hours mention should not be added to labor hours; keep in notes
    const hh = findHelperHours(e.notes || '');
    if (hh && !e.materials) {
      // if helper payment is present as a dollar amount in the same notes, find it
      const m = findMoney(e.notes || '');
      if (m) e.materials = m;
    }

    // compute totalHours from start/end if present
    if ((!e.totalHours || Number(e.totalHours) === 0) && e.start && e.end) {
      e.totalHours = computeHoursFromTimes(e.start, e.end);
    }

    // If materials is present but not numeric, attempt cast
    if (e.materials != null) e.materials = Number(e.materials);
  }

  return entries;
}

module.exports = { parseTextToEntries };
