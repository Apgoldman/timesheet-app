const { DateTime } = require("luxon");

// Try to load @googlemaps/google-maps-services-js only if available.
// If it's not installed, we fall back to keyword/length heuristic only.
let GoogleMapsClient = null;
try {
  GoogleMapsClient = require("@googlemaps/google-maps-services-js").Client;
} catch (err) {
  GoogleMapsClient = null;
  // Google Maps client not installed; allocation will use heuristics only.
}

async function allocateTimesAcrossAddresses(entries, googleMapsApiKey = null, opts = {}) {
  // entries: array of objects { worker, date (ISO or text), address, start, end, totalHours, notes, materials }
  // Group by worker+date
  const grouped = {};
  for (const e of entries) {
    const wk = `${e.worker}||${e.date}`;
    if (!grouped[wk]) grouped[wk] = [];
    grouped[wk].push(Object.assign({}, e));
  }

  const out = [];
  for (const key of Object.keys(grouped)) {
    const rows = grouped[key];
    // If only one address or each row has start & end, just normalize & round
    const needsAllocation = rows.some(r => !r.start && !r.end && r.totalHours);
    if (!needsAllocation) {
      for (const r of rows) out.push(r);
      continue;
    }

    // Weighting (keyword/length heuristic)
    let weights = rows.map(r => 1.0);
    for (let i = 0; i < rows.length; i++) {
      const notes = (rows[i].notes || "").toLowerCase();
      if (notes.match(/install|replace|reinstallation|major|complete|cartridge|repair/)) weights[i] += 1.0;
      if (notes.match(/clean|check|inspect|sweep|mop|salt/)) weights[i] += 0.5;
      weights[i] += Math.min(1.0, (rows[i].notes || "").length / 120.0);
    }

    // Optionally incorporate travel time via Google Maps if API key present and client is installed
    if (googleMapsApiKey && GoogleMapsClient) {
      try {
        const client = new GoogleMapsClient({});
        const origins = [rows[0].address || ""];
        const destinations = rows.map(r => r.address || "");
        const resp = await client.distancematrix({
          params: { origins, destinations, key: googleMapsApiKey }
        });
        const elements = (resp && resp.data && resp.data.rows && resp.data.rows[0] && resp.data.rows[0].elements) || [];
        for (let i = 0; i < elements.length; i++) {
          const el = elements[i];
          if (el && el.duration && el.duration.value) {
            // duration in seconds -> add small weight
            weights[i] += Math.min(2, el.duration.value / 1800); // every 30 min add up to +2
          }
        }
      } catch (err) {
        console.warn("Google Maps request failed, falling back to keyword weighting", err.message || err);
      }
    }

    // Normalize weights and allocate totalHours
    const totalHours = rows.reduce((s, r) => s + (r.totalHours || 0), 0) || (rows[0].totalHours || 0);
    const sumW = weights.reduce((s, x) => s + x, 0) || 1;
    const dayTotal = totalHours > 0 ? totalHours : 8;
    const allocations = weights.map(w => (w / sumW) * dayTotal);

    // Build start/end times by assigning from a default work window (09:00..)
    const tz = opts.tz || "America/New_York";
    let currentStart = DateTime.fromObject({ hour: 9, minute: 0 }, { zone: tz });
    for (let i = 0; i < rows.length; i++) {
      const hours = Math.round(allocations[i] * 4) / 4; // nearest 15 min
      const minutes = Math.round(hours * 60);
      const start = currentStart;
      const end = start.plus({ minutes });
      rows[i].start = start.toFormat("HH:mm");
      rows[i].end = end.toFormat("HH:mm");
      rows[i].totalHours = minutes / 60;
      currentStart = end.plus({ minutes: 15 }); // travel buffer
      out.push(rows[i]);
    }
  }
  return out;
}

module.exports = { allocateTimesAcrossAddresses };