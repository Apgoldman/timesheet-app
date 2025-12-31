// Minimal Express server scaffold
// Endpoints: upload images/csv, parse OCR, preview, export

const path = require("path");
const express = require("express");
const multer = require("multer");
const fs = require("fs");
const { parseOcrImages } = require("./vision");
const { allocateTimesAcrossAddresses } = require("./allocator");
const { generateWorkerExcel } = require("./exporter");

const UPLOAD_DIR = path.join(__dirname, "..", "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({ storage });

const app = express();
app.use(express.json());

// serve uploaded files
app.use("/uploads", express.static(UPLOAD_DIR));

// Serve public static files and return index.html at root
app.use(express.static(path.join(__dirname, "..", "public")));
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

// Simple in-memory store for uploaded files & parsed drafts (for prototype)
const store = { images: [], parsedDrafts: [] };

app.post("/api/upload/image", upload.array("images", 12), (req, res) => {
  const files = req.files.map(f => ({ path: f.path, originalname: f.originalname }));
  store.images.push(...files);
  return res.json({ ok: true, images: files });
});

app.post("/api/upload/csv", upload.single("file"), (req, res) => {
  // For prototype, return file path — parsing CSV mapping will be added in full app
  return res.json({ ok: true, path: req.file.path });
});

app.post("/api/parse/ocr", async (req, res) => {
  // parse all currently uploaded images
  if (!store.images.length) return res.status(400).json({ ok: false, message: "No images uploaded" });
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

app.post("/api/preview", (req, res) => {
  // Accept parsed/edited entries from frontend and run allocation heuristics if needed.
  // Body shape: { entries: [ { worker, date, address, unit, start, end, totalHours, materials, notes } ] }
  const { entries } = req.body;
  if (!entries || !Array.isArray(entries)) return res.status(400).json({ ok: false, message: "entries required" });
  // If some rows only have totalHours and multiple addresses same day, allocate using allocator.
  const allocated = allocateTimesAcrossAddresses(entries, process.env.GOOGLE_MAPS_API_KEY || null, { tz: process.env.TZ || "America/New_York" });
  // Save allocated draft for export
  const draftId = Date.now().toString();
  store.parsedDrafts.push({ id: draftId, timestamp: new Date(), entries: allocated });
  return res.json({ ok: true, draftId, entries: allocated });
});

app.post("/api/export", async (req, res) => {
  // body: { draftId, worker, weekStartISO }
  const { draftId, worker, weekStartISO } = req.body;
  const draft = store.parsedDrafts.find(d => d.id === draftId);
  if (!draft) return res.status(404).json({ ok: false, message: "Draft not found" });
  // filter by worker and week
  const filepath = await generateWorkerExcel(draft.entries, worker, weekStartISO, { outDir: path.join(__dirname, "..", "output") });
  // Determine filename and download path from either `filepath` (string) or `result` (object)
  let filename;
  if (typeof filepath === 'string') {
    filename = require('path').basename(filepath);
  } else if (result && typeof result === 'string') {
    filename = require('path').basename(result);
  } else if (result && result.filename) {
    filename = result.filename;
  } else if (result && result.path) {
    filename = require('path').basename(result.path);
  } else {
    return res.status(500).json({ ok: false, message: 'Exporter returned no filename' });
  }

  const url = `/download/${filename}`;

  // Figure out the real path we'll hand to res.download
  const downloadPath = (typeof filepath === 'string')
    ? filepath
    : (result && result.path)
      ? result.path
      : null;

  if (!downloadPath) {
    return res.status(500).json({ ok: false, message: 'No file path available for download' });
  }

  // serve file statically for download
  app.get(url, (req2, res2) => res2.download(downloadPath));

  return res.json({ ok: true, downloadUrl: url, filename });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));