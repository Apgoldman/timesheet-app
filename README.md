 #!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="timesheet-app"
SERVER_DIR="$ROOT_DIR/server"
ZIP_NAME="weekly-timesheet-scaffold.zip"

echo "Creating project in ./$ROOT_DIR ..."

rm -rf "$ROOT_DIR" "$ZIP_NAME"
mkdir -p "$SERVER_DIR"

cat > package.json <<'EOF'
{
  "name": "weekly-timesheet-app",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "start": "node server/index.js",
    "dev": "nodemon server/index.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "multer": "^1.4.5",
    "xlsx": "^0.18.5",
    "luxon": "^3.4.0",
    "@google-cloud/vision": "^4.6.0",
    "@googlemaps/google-maps-services-js": "^3.3.16"
  },
  "devDependencies": {
    "nodemon": "^2.0.22"
  }
}
EOF

cat > "$SERVER_DIR/index.js" <<'EOF'
// Minimal Express server scaffold
// Endpoints:
// POST /api/upload/image  -> upload image(s)
// POST /api/upload/csv    -> upload CSV
// POST /api/parse/ocr     -> run OCR on most recent uploaded image(s) (uses Google Vision if creds set)
// POST /api/preview       -> accept parsed entries and return preview (server-side validation + allocation)
// POST /api/export        -> generate .xlsx for given worker/week and return path

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { parseOcrImages } = require('./vision');
const { allocateTimesAcrossAddresses } = require('./allocator');
const { generateWorkerExcel } = require('./exporter');

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({ storage });

const app = express();
app.use(express.json());
app.use('/uploads', express.static(UPLOAD_DIR));

// Simple in-memory store for uploaded files & parsed drafts (for prototype)
const store = { images: [], parsedDrafts: [] };

app.post('/api/upload/image', upload.array('images', 12), (req, res) => {
  const files = req.files.map(f => ({ path: f.path, originalname: f.originalname }));
  store.images.push(...files);
  return res.json({ ok: true, images: files });
});

app.post('/api/upload/csv', upload.single('file'), (req, res) => {
  // For prototype, return file path — parsing CSV mapping will be added in full app
  return res.json({ ok: true, path: req.file.path });
});

app.post('/api/parse/ocr', async (req, res) => {
  // parse all currently uploaded images
  if (!store.images.length) return res.status(400).json({ ok: false, message: 'No images uploaded' });
  try {
    const results = [];
    for (const img of store.images) {
      const parsed = await parseOcrImages(img.path); // returns parsed text & candidate fields
      results.push({ image: img, parsed });
    }
    // store a draft for user to review (in real app, persist to DB)
    store.parsedDrafts.push({ id: Date.now().toString(), timestamp: new Date(), results });
    return res.json({ ok: true, draftId: store.parsedDrafts[store.parsedDrafts.length-1].id, results });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/preview', (req, res) => {
  // Accept parsed/edited entries from frontend and run allocation heuristics if needed.
  // Body shape: { entries: [ { worker, date, address, unit, start, end, totalHours, materials, notes } ] }
  const { entries } = req.body;
  if (!entries || !Array.isArray(entries)) return res.status(400).json({ ok: false, message: 'entries required' });
  // If some rows only have totalHours and multiple addresses same day, allocate using allocator.
  const allocated = allocateTimesAcrossAddresses(entries, process.env.GOOGLE_MAPS_API_KEY || null, { tz: process.env.TZ || 'America/New_York' });
  // Save allocated draft for export
  const draftId = Date.now().toString();
  store.parsedDrafts.push({ id: draftId, timestamp: new Date(), entries: allocated });
  return res.json({ ok: true, draftId, entries: allocated });
});

app.post('/api/export', async (req, res) => {
  // body: { draftId, worker, weekStartISO }
  const { draftId, worker, weekStartISO } = req.body;
  const draft = store.parsedDrafts.find(d => d.id === draftId);
  if (!draft) return res.status(404).json({ ok: false, message: 'Draft not found' });
  // filter by worker and week
  const filepath = await generateWorkerExcel(draft.entries, worker, weekStartISO, { outDir: path.join(__dirname, '..', 'output') });
  const url = `/download/${path.basename(filepath)}`;
  // serve file statically
  app.get(url, (req2, res2) => res2.download(filepath));
  return res.json({ ok: true, downloadUrl: url });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
EOF

cat > "$SERVER_DIR/vision.js" <<'EOF'
// vision.js - wrapper for OCR parsing
// If GOOGLE_APPLICATION_CREDENTIALS is set or VISION_SERVICE_ACCOUNT_JSON env var present, this will call Google Vision.
// Otherwise returns a small mocked parse result for the uploaded image so you can test flows.

const fs = require('fs');
const path = require('path');

async function parseOcrImages(imagePath) {
  // If Google Vision credentials not present, return a mocked parse for testing
  const useGoogle = !!process.env.GOOGLE_APPLICATION_CREDENTIALS || !!process.env.VISION_SERVICE_ACCOUNT_JSON;
  if (!useGoogle) {
    // Return a very small mock parse so frontend can be tested without credentials
    return {
      rawText: 'MOCK OCR: 1513 Lafayette\\n9:00-5:30\\nChecked water pressure\\nMaterials: $10',
      fields: [
        { date: null, address: '1513 Lafayette', unit: '', start: '09:00', end: '17:30', totalHours: null, worker: null, materials: 10, notes: 'Checked water pressure' }
      ]
    };
  }

  // Real Google Vision flow
  const vision = require('@google-cloud/vision');
  let client;
  if (process.env.VISION_SERVICE_ACCOUNT_JSON) {
    const json = JSON.parse(process.env.VISION_SERVICE_ACCOUNT_JSON);
    client = new vision.ImageAnnotatorClient({ credentials: json });
  } else {
    client = new vision.ImageAnnotatorClient(); // uses GOOGLE_APPLICATION_CREDENTIALS env var path
  }

  const [result] = await client.documentTextDetection(imagePath);
  const fullText = result.fullTextAnnotation ? result.fullTextAnnotation.text : '';
  // Basic heuristic parser: find lines with addresses, times, dollar amounts, and short notes.
  // This parser will be improved later; frontend allows manual correction.
  const lines = fullText.split(/\\r?\\n/).map(l => l.trim()).filter(Boolean);
  const fields = [];
  let current = {};
  for (const line of lines) {
    // detect date-like
    if (/\\b\\d{1,2}[:.]\\d{2}\\s*(AM|PM)?\\b/i.test(line) || /\\b\\d{1,2}[:.]\\d{2}\\b/.test(line)) {
      // time info
      const times = line.match(/\\d{1,2}[:.]\\d{2}\\s*(AM|PM)?/ig) || [];
      if (times.length >= 2) {
        current.start = times[0];
        current.end = times[1];
      } else if (times.length === 1) {
        current.totalHours = null; // require allocation
      }
    } else if (/\\$\\d+/.test(line)) {
      const m = line.match(/\\$(\\d+(\\.\\d+)?)/);
      current.materials = m ? parseFloat(m[1]) : current.materials || 0;
    } else if (/[0-9]+\\s+[A-Za-z]/.test(line) || /[A-Za-z]+\\s+(Avenue|Ave|St|Street|Lafayette|Maple|Monroe|Lincoln)/i.test(line)) {
      // treat as address line
      if (current.address) {
        fields.push(current);
        current = {};
      }
      current.address = line;
    } else {
      // append to notes
      current.notes = (current.notes ? current.notes + ' ' : '') + line;
    }
  }
  if (Object.keys(current).length) fields.push(current);
  return { rawText: fullText, fields };
}

module.exports = { parseOcrImages };
EOF

cat > "$SERVER_DIR/allocator.js" <<'EOF'
// allocator.js
// Allocate total daily hours across multiple addresses for a worker/date using Google Maps travel-time weighting (if API key present).
// For prototype: if no API key provided, do a simple keyword & length-based weighting.

const { DateTime } = require('luxon');
const { Client } = require('@googlemaps/google-maps-services-js');

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
      // ensure rounding to nearest 15min for start/end if present
      for (const r of rows) out.push(r);
      continue;
    }

    // Weighting
    let weights = rows.map(r => 1.0);
    // keyword/length heuristic
    for (let i = 0; i < rows.length; i++) {
      const notes = (rows[i].notes || '').toLowerCase();
      if (notes.match(/install|replace|reinstallation|major|complete|cartridge|repair/)) weights[i] += 1.0;
      if (notes.match(/clean|check|inspect|sweep|mop|salt/)) weights[i] += 0.5;
      weights[i] += Math.min(1.0, (rows[i].notes || '').length / 120.0);
      // base 1.0 already set
    }

    // Optionally incorporate travel time via Google Maps: increases weight for addresses farther apart
    if (googleMapsApiKey) {
      try {
        const client = new Client({});
        // For prototype, compute travel from first address to others (simple)
        const origins = [rows[0].address];
        const destinations = rows.map(r => r.address);
        const resp = await client.distancematrix({ params: { origins, destinations, key: googleMapsApiKey } });
        const elements = resp.data.rows[0].elements;
        for (let i = 0; i < elements.length; i++) {
          const el = elements[i];
          if (el && el.duration && el.duration.value) {
            // duration in seconds -> add small weight
            weights[i] += Math.min(2, el.duration.value / 1800); // every 30 min add up to +2
          }
        }
      } catch (err) {
        console.warn('Google Maps request failed, falling back to keyword weighting', err.message);
      }
    }

    // Normalize weights and allocate totalHours
    const totalHours = rows.reduce((s, r) => s + (r.totalHours || 0), 0) || (rows[0].totalHours || 0);
    const sumW = weights.reduce((s, x) => s + x, 0);
    // If totalHours is missing or zero, fallback to 8 hours
    const dayTotal = totalHours > 0 ? totalHours : 8;
    const allocations = weights.map(w => (w / sumW) * dayTotal);

    // Build start/end times by assigning from a default work window (09:00..)
    const tz = opts.tz || 'America/New_York';
    let currentStart = DateTime.fromObject({ hour: 9, minute: 0 }, { zone: tz });
    for (let i = 0; i < rows.length; i++) {
      const hours = Math.round(allocations[i] * 4) / 4; // round to nearest 0.25 hr (15 min)
      const minutes = Math.round(hours * 60);
      const start = currentStart;
      const end = start.plus({ minutes });
      rows[i].start = start.toFormat('HH:mm');
      rows[i].end = end.toFormat('HH:mm');
      rows[i].totalHours = minutes / 60;
      currentStart = end.plus({ minutes: 15 }); // default travel buffer 15 min
      out.push(rows[i]);
    }
  }
  return out;
}

module.exports = { allocateTimesAcrossAddresses };
EOF

cat > "$SERVER_DIR/exporter.js" <<'EOF'
// exporter.js - generate Excel per worker per week using xlsx and the business rules you provided.

const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const { DateTime } = require('luxon');

const RATES = {
  'Jose': 25,
  'José': 25,
  'Myer': 20,
  'Damian': 30,
  'Chris': 30
};

function isWeekend(dateISO) {
  const dt = DateTime.fromISO(dateISO);
  return dt.weekday === 6 || dt.weekday === 7;
}

async function generateWorkerExcel(allEntries, workerName, weekStartISO, opts = {}) {
  const outDir = opts.outDir || path.join(__dirname, '..', 'output');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const wb = XLSX.utils.book_new();
  // Filter entries for worker and week
  const weekStart = DateTime.fromISO(weekStartISO);
  const weekEnd = weekStart.plus({ days: 7 });
  const rows = [['Date','Address','Unit #','Start Time','End Time','Total Hours','Worker','Worker Pay','Description','Materials Cost']];

  const entries = allEntries.filter(e => (e.worker || '').toLowerCase() === (workerName || '').toLowerCase())
    .filter(e => {
      const dt = DateTime.fromISO(e.date);
      return dt >= weekStart && dt < weekEnd;
    });

  for (const e of entries) {
    const dateISO = DateTime.fromISO(e.date).toISODate();
    const unit = e.unit || '';
    const start = e.start || '';
    const end = e.end || '';
    const totalHours = Number(e.totalHours || 0);
    const rate = RATES[workerName] || RATES[e.worker] || 0;
    let pay = totalHours * rate;
    // weekend multiplier for Jose, Damian, Chris
    const wname = workerName;
    if (isWeekend(dateISO) && (['Jose','José','Damian','Chris'].includes(wname))) {
      pay = totalHours * rate * 1.5;
    }
    // Materials: numeric or blank
    const materials = e.materials ? Number(e.materials) : '';
    // Shorten description to one-liner
    const desc = (e.notes || '').replace(/\\s+/g,' ').trim().slice(0,140);
    rows.push([dateISO, e.address || '', unit, start, end, roundDecimal(totalHours,2), workerName, roundDecimal(pay,2), desc, materials]);
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = rows[0].map(h => ({ wch: Math.min(Math.max(h.length + 6, 10), 40) }));
  XLSX.utils.book_append_sheet(wb, ws, 'Timesheet');
  const filename = `${workerName.replace(/\\s+/g,'_')}_week_${weekStartISO}.xlsx`;
  const outPath = path.join(outDir, filename);
  XLSX.writeFile(wb, outPath);
  return outPath;
}

function roundDecimal(n, places) {
  return Math.round(n * Math.pow(10, places)) / Math.pow(10, places);
}

module.exports = { generateWorkerExcel };
EOF

cat > README.md <<'EOF'
# Weekly Timesheet App (Prototype)

This prototype provides a local web-service to:
- Upload images (handwritten logs) and CSVs
- Run OCR (Google Vision) or use mock OCR for testing
- Preview parsed entries and allocate daily hours across addresses (Maps-based weighting optional)
- Export one Excel file per worker per week with your specified columns and pay rules

Requirements:
- Node.js 16+
- npm

Install:
1. npm install

Environment:
- TZ (default: America/New_York)
- WEEK_START (default: Monday)
- GOOGLE_APPLICATION_CREDENTIALS (optional): path to Vision service account JSON, OR
- VISION_SERVICE_ACCOUNT_JSON (optional): paste JSON content as env var (less secure)
- GOOGLE_MAPS_API_KEY (optional): for travel-time weighting
- OCR_AUTO_DELETE_IMAGES (true/false) default: true

Run:
- npm start
- Server runs at http://localhost:3000

Endpoints (prototype):
- POST /api/upload/image (multipart form 'images') -> upload images
- POST /api/parse/ocr -> runs OCR on uploaded images (uses Google Vision if credentials are present)
- POST /api/preview -> accept edited/confirmed entries and receive allocations
- POST /api/export -> generate .xlsx for a worker/week and get download URL

Notes:
- OCR will be mocked if no Vision credentials are provided. Provide Google credentials (recommended) to test real OCR.
- The frontend in this prototype is minimal (not included); the API is ready for integration.
- After initial review I will add a React UI for upload, preview and assignment.

Security:
- If you provide Vision credentials, keep them private. Recommended workflow:
  1. I provide scaffold (zip or repo).
  2. You run locally and set env vars with your credentials.
  3. Upload images and run OCR locally so your credentials never leave your machine.

Next steps:
- Tell me whether you want the React UI scaffold added, or if you want me to push to your GitHub repo (requires collaborator access).
EOF

cat > .gitignore <<'EOF'
node_modules/
.env
uploads/
output/
*.log
EOF

echo "Installing npm dependencies (this may take a minute)..."
( cd "$ROOT_DIR" && npm install --no-audit --no-fund )

echo "Creating zip $ZIP_NAME ..."
zip -r "$ZIP_NAME" "$ROOT_DIR" > /dev/null

echo "Done."
echo "Folder: $ROOT_DIR"
echo "Zip: $ZIP_NAME"
echo "To run:"
echo "  cd $ROOT_DIR"
echo "  export TZ=\"America/New_York\""
echo "  export WEEK_START=\"Monday\""
echo "  export GOOGLE_APPLICATION_CREDENTIALS=\"/full/path/to/vision-service-account.json\""
echo "  export GOOGLE_MAPS_API_KEY=\"YOUR_GOOGLE_MAPS_KEY\""
echo "  export OCR_AUTO_DELETE_IMAGES=\"true\""
echo "  npm start"
