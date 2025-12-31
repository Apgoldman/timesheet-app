/* lib/parser.js
   Heuristics improvements:
   - Avoid treating time-only lines as addresses.
   - Prefer addresses with street keywords or number+word patterns.
   - Avoid matching time strings as money.
   - Try to pick a nearby address candidate rather than the first fallback.
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
  const m1 = line.match(/(\b\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})\b)/);
  if (m1) return parseMmDdToIso(m1[1]);

  const m2 = line.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:,?\s*(\d{4}))?/i);
  if (m2) {
    const months = {jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12};
    const mm = String(months[m2[1].slice(0,3).toLowerCase()]).padStart(2,'0');
    const dd = String(m2[2]).padStart(2,'0');
    const yy = m2[3] || String(new Date().getFullYear());
    return `${yy}-${mm}-${dd}`;
  }

  const wd = line.match(/\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|wed|thu|fri|sat)\b/i);
  if (wd) {
    return isoForWeekday(wd[1]);
  }

  return null;
}

function isoForWeekday(name) {
  const key = name.toLowerCase().slice(0,3);
  const target = WEEKDAYS[key];
  if (target == null) return null;
  const today = new Date();
  const todayDay = today.getDay(); // 0..6
  let diff = todayDay - target;
  if (diff < 0) diff += 7;
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - diff);
  return d.toISOString().slice(0,10);
}

function normalizeTime(ts) {
  if (!ts) return null;
  let t = ts.trim().replace(/\./g,'');
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

function findTimes(line) {
  if (!line) return null;
  const m = line.match(/(\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)?)\s*[–—\-to]{1,3}\s*(\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)?)/);
  if (m) {
    return { start: normalizeTime(m[1]), end: normalizeTime(m[2]) };
  }
  const m2 = line.match(/hours[:\s]*([\d:]{1,5}\s*(?:AM|PM|am|pm)?)\s*[–—\-to]{1,3}\s*([\d:]{1,5}\s*(?:AM|PM|am|pm)?)/i);
  if (m2) return { start: normalizeTime(m2[1]), end: normalizeTime(m2[2]) };
  const ms = line.match(/start(?:ed)?\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(AM|PM|am|pm)?/);
  const me = line.match(/stop(?:ped)?\s*(?:at)?\s+(\d{1,2})(?::(\d{2}))?\s*(AM|PM|am|pm)?/);
  if (ms && me) {
    const s = ms[1].padStart(2,'0') + ':' + (ms[2] || '00') + (ms[3] ? ' ' + ms[3] : '');
    const e = me[1].padStart(2,'0') + ':' + (me[2] || '00') + (me[3] ? ' ' + me[3] : '');
    return { start: normalizeTime(s), end: normalizeTime(e) };
  }
  return null;
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

function isTimeOnly(line) {
  if (!line) return false;
  if (/^\s*(?:AM|PM|am|pm)\.?$/.test(line)) return true;
  if (/^\s*\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)?\s*$/.test(line)) return true;
  if (/^\s*\d{1,2}\s*(?:AM|PM|am|pm)\s*$/.test(line)) return true;
  return false;
}

function findMoney(line) {
  if (!line) return null;
  const mDollar = line.match(/\$\s*([0-9]+(?:\.[0-9]{1,2})?)/);
  if (mDollar) return parseFloat(mDollar[1]);

  const mKeyword = line.match(/(?:gas|materials|material|helper|paid|cost|charge|fee)[:\s]*\$?\s*([0-9]+(?:\.[0-9]{1,2})?)/i);
  if (mKeyword) {
    const cand = mKeyword[1];
    if (!/^\d{1,2}:\d{2}$/.test(cand)) return parseFloat(cand);
  }

  return null;
}

function findHelperHours(line) {
  if (!line) return null;
  const m = line.match(/helper\s*(?:[:\-]?\s*)?(\d+(?:\.\d+)?)\s*(?:hrs|hours|hr)?/i);
  if (m) return parseFloat(m[1]);
  return null;
}

function looksLikePhone(line) {
  if (!line) return false;
  return /(?:\+?\d{1,2}[-.\s]?)?(?:\(\d{3}\)|\d{3})[-.\s]?\d{3}[-.\s]?\d{4}/.test(line);
}

function findAddressCandidate(line) {
  if (!line) return null;
  if (isTimeOnly(line)) return null;
  if (/\b(St|Street|Ave|Avenue|Rd|Road|Blvd|Drive|Dr|Market|Spring|Lane|Ln|Court|Ct|Way|Place|Terrace|Terr)\b/i.test(line)) {
    return line.trim();
  }
  if (/\b\d{1,5}\s+[A-Za-z0-9\.\- ]{3,}\b/.test(line)) {
    if (!/^\s*\d+\s*$/.test(line)) return line.trim();
  }
  if (looksLikePhone(line)) return line.trim();
  return null;
}

function findAddress(line) {
  return findAddressCandidate(line);
}

function computeHoursFromTimes(start, end) {
  const s = parseTimeToMinutes(start);
  const e = parseTimeToMinutes(end);
  if (s == null || e == null) return 0;
  let minutes = e - s;
  if (minutes < 0) minutes += 24 * 60;
  minutes = roundToNearestQuarterMinutes(minutes);
  return Math.round((minutes / 60) * 100) / 100;
}

function parseTextToEntries(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const entries = [];
  let current = null;
  const recent = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    recent.push(line);
    if (recent.length > 6) recent.shift();

    const worker = findWorker(line);
    const date = findDate(line);
    const times = findTimes(line);
    const money = findMoney(line);
    const helperH = findHelperHours(line);
    const addressCand = findAddressCandidate(line);

    if (worker && line.includes(':')) {
      if (current) entries.push(current);
      current = { worker: worker, date: date || null, address: null, start: null, end: null, totalHours: null, materials: null, notes: '' };
      if (times) { current.start = times.start; current.end = times.end; }
      if (money) current.materials = money;
      if (helperH) current.notes += `helper ${helperH}hrs. `;
      const after = line.split(':').slice(1).join(':').trim();
      if (after) current.notes += after + ' ';
      continue;
    }

    if (!current && times) {
      current = { worker: null, date: date || null, address: null, start: times.start, end: times.end, totalHours: null, materials: null, notes: '' };
      continue;
    }

    if (current) {
      if (!current.date && date) current.date = date;
      if (!current.address && addressCand) current.address = addressCand;
      if (!current.start && times) { current.start = times.start; current.end = times.end; }
      if (!current.materials && money) current.materials = money;
      if (helperH) current.notes += `helper ${helperH}hrs. `;
      current.notes += line + ' ';
    } else {
      if (addressCand || date || times || money || worker) {
        current = { worker: worker || null, date: date || null, address: addressCand || null, start: times ? times.start : null, end: times ? times.end : null, totalHours: null, materials: money || null, notes: line };
      }
    }
  }

  if (current) entries.push(current);

  for (const e of entries) {
    if (!e.address && e.notes) {
      const noteLines = e.notes.split(/\s{2,}|\r?\n|(?<=\.)\s+/).map(s => s.trim()).filter(Boolean);
      for (const nl of noteLines) {
        const cand = findAddressCandidate(nl);
        if (cand) { e.address = cand; break; }
      }
    }

    if (!e.date && e.notes) {
      const wd = e.notes.match(/\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|wed|thu|fri|sat)\b/i);
      if (wd) e.date = isoForWeekday(wd[1]);
    }

    if (!e.date && e.start && e.end) e.date = new Date().toISOString().slice(0,10);

    if (!e.materials && e.notes) {
      const m = findMoney(e.notes);
      if (m) e.materials = m;
    }

    if ((!e.totalHours || Number(e.totalHours) === 0) && e.start && e.end) {
      e.totalHours = computeHoursFromTimes(e.start, e.end);
    }

    if (e.materials != null) e.materials = Number(e.materials);
  }

  return entries;
}

module.exports = { parseTextToEntries };