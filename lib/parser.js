/* lib/parser.js
   Simple heuristics to parse freeform OCR/text logs into structured entries.
   This is heuristic and intended to work with the examples you provided.
*/
const WORKERS = ["Jose","José","Damian","Chris","Myer"];

function findWorker(line) {
  for (const w of WORKERS) {
    const r = new RegExp('\\b' + w + '\\b','i');
    if (r.test(line)) return w;
  }
  return null;
}

function findDate(line) {
  if (!line) return null;
  // mm/dd or mm/dd/yy or mm/dd/yyyy
  const m1 = line.match(/(\b\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})\b)/);
  if (m1) {
    // Normalize to YYYY-MM-DD if possible (assume year 20xx if 2-digit)
    const parts = m1[1].split(/[\/\-]/).map(p=>p.trim());
    let mm = parts[0].padStart(2,'0'), dd = parts[1].padStart(2,'0'), yy = parts[2];
    if (!yy) {
      // No year — assume current year
      const y = new Date().getFullYear();
      yy = String(y);
    } else if (yy.length === 2) {
      yy = '20' + yy;
    }
    return `${yy}-${mm}-${dd}`;
  }
  // Month name like "Dec 11" or "December 11"
  const m2 = line.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:,?\s*(\d{4}))?/i);
  if (m2) {
    const months = {jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12};
    const mm = String(months[m2[1].slice(0,3).toLowerCase()]).padStart(2,'0');
    const dd = String(m2[2]).padStart(2,'0');
    const yy = m2[3] || String(new Date().getFullYear());
    return `${yy}-${mm}-${dd}`;
  }
  return null;
}

function findTimes(line) {
  if (!line) return null;
  // look for patterns like "9:00 AM - 5:30 PM" or "9:00 AM – 5:30 PM" or "9:00-17:00"
  const m = line.match(/(\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)?)[\s–—\-to]{1,3}(\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)?)/);
  if (m) {
    return { start: m[1].trim(), end: m[2].trim() };
  }
  // "Hours: 9:00 AM – 5:30 PM"
  const m2 = line.match(/hours[:\s]*([\d:]{1,5}\s*(?:AM|PM|am|pm)?)\s*[–—\-to]{1,3}\s*([\d:]{1,5}\s*(?:AM|PM|am|pm)?)/i);
  if (m2) return { start: m2[1].trim(), end: m2[2].trim() };
  // "started at 10" — assume hours and maybe stop at "stop at 2" meaning 14:00
  const ms = line.match(/start(?:ed)?\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(AM|PM|am|pm)?/);
  const me = line.match(/stop(?:ped)?\s*(?:at)?\s+(\d{1,2})(?::(\d{2}))?\s*(AM|PM|am|pm)?/);
  if (ms && me) {
    const s = ms[1].padStart(2,'0') + ':' + (ms[2] || '00');
    const e = me[1].padStart(2,'0') + ':' + (me[2] || '00');
    return { start: s, end: e };
  }
  return null;
}

function findMoney(line) {
  if (!line) return null;
  const m = line.match(/\$?\s*([0-9]+(?:\.[0-9]{1,2})?)/);
  if (m) return parseFloat(m[1]);
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
  // "Jobs: 42 Carbondale" -> "42 Carbondale"
  const m = line.match(/jobs[:\s]*\s*(\d+\s+[A-Za-z0-9\.\- ]+)/i);
  if (m) return m[1].trim();
  return null;
}

function parseTextToEntries(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const entries = [];
  let current = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // new worker block if a line starts with worker name followed by ":" or has worker name
    const worker = findWorker(line);
    const date = findDate(line);
    const times = findTimes(line);
    const money = findMoney(line);
    const helperH = findHelperHours(line);
    const address = findAddress(line);

    if (worker && line.includes(':')) {
      // start a new block
      if (current) entries.push(current);
      current = { worker: worker, date: date || null, address: address || null, start: null, end: null, totalHours: null, materials: null, notes: '' };
      // if this same line contains times/money/helper, capture
      if (times) { current.start = times.start; current.end = times.end; }
      if (money) current.materials = money;
      if (helperH) current.notes += `helper ${helperH}hrs. `;
      // remaining text as notes
      const after = line.split(':').slice(1).join(':').trim();
      if (after) current.notes += after + ' ';
      continue;
    }

    // If line contains "Hours:" or times and no current block, create one with unknown worker
    if (!current && times) {
      current = { worker: null, date: date || null, address: address || null, start: times.start, end: times.end, totalHours: null, materials: null, notes: '' };
      continue;
    }

    // If currently in a block, attach info
    if (current) {
      if (!current.date && date) current.date = date;
      if (!current.address && address) current.address = address;
      if (!current.start && times) { current.start = times.start; current.end = times.end; }
      if (!current.materials && money) current.materials = money;
      if (helperH) current.notes += `helper ${helperH}hrs. `;
      // append everything else to notes
      current.notes += line + ' ';
    } else {
      // no current block — try to create a minimal entry from line if it looks like an address or worker
      if (worker || address || date || times || money) {
        current = { worker: worker || null, date: date || null, address: address || null, start: times ? times.start : null, end: times ? times.end : null, totalHours: null, materials: money || null, notes: line };
      }
    }
  }

  if (current) entries.push(current);

  // Post-process: for entries with helper money separate materials field if text includes a dollar with no $ sign we still capture money as materials
  for (const e of entries) {
    if (e.notes) {
      const m = findMoney(e.notes);
      if (m && !e.materials) e.materials = m;
      const hh = findHelperHours(e.notes);
      if (hh) e.notes += ` helperHours:${hh}`;
    }
  }

  // Normalize dates to YYYY-MM-DD if possible: if a date was found as mm/dd with no year, try to infer current year
  for (const e of entries) {
    if (e.date && /^\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?$/.test(e.date)) {
      // already matched mm/dd(-yyyy) earlier and was normalized there; keep as-is
    } else if (e.date && /^\d{4}-\d{2}-\d{2}$/.test(e.date)) {
      // already ISO
    } else if (!e.date) {
      // leave blank
    }
  }

  return entries;
}

module.exports = { parseTextToEntries };
