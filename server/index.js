// server/index.js (updated) — adds OCR/text parsing endpoints and export metadata
const path = require("path");
const express = require("express");
const multer = require("multer");
const fs = require("fs");
const { allocateTimesAcrossAddresses } = require("../lib/allocator");
const { generateWorkerExcel } = require("../lib/exporter");
const { parseTextToEntries } = require("../lib/parser");

const UPLOAD_DIR = path.join(__dirname, "..", "uploads");
const OUTPUT_DIR = path.join(__dirname, "..", "output");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

/*
  If you set GOOGLE_APPLICATION_CREDENTIALS_JSON (the service account JSON content) in env,
  write it to a temp file and set GOOGLE_APPLICATION_CREDENTIALS so google client libraries work.
  Do NOT commit the key — set it via Render environment variables.
*/
if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  try {
    const dst = path.join("/tmp", `gcloud-key-${Date.now()}.json`);
    fs.writeFileSync(dst, process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON, { encoding: "utf8", mode: 0o600 });
    process.env.GOOGLE_APPLICATION_CREDENTIALS = dst;
    console.log("Wrote Google credentials to", dst);
  } catch (err) {
    console.error("Failed to write GOOGLE_APPLICATION_CREDENTIALS_JSON:", err && err.message);
  }
}

let visionClient = null;
try {
  const Vision = require("@google-cloud/vision");
  visionClient = new Vision.ImageAnnotatorClient();
} catch (err) {
  console.warn("Google Vision client not available. OCR endpoint will fallback to text upload only or error:", err && err.message);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({ storage });

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// serve uploaded files and output
app.use("/uploads", express.static(UPLOAD_DIR));
app.use("/output", express.static(OUTPUT_DIR));

// Serve public static files and return index.html at root
app.use(express.static(path.join(__dirname, "..", "public")));
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

// Simple in-memory store for drafts
const store = { parsedDrafts: [] };

// Upload file (existing) — returns path and url
app.post("/api/upload/csv", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, message: "file required" });
  const savedPath = req.file.path;
  const basename = path.basename(savedPath);
  const publicUrl = `/uploads/${basename}`;
  return res.json({ ok: true, path: savedPath, url: publicUrl, filename: basename });
});

// OCR parse endpoint — accepts an image upload and runs Google Vision text detection, then parses
app.post("/api/parse/ocr", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, message: "file required" });
  if (!visionClient) return res.status(500).json({ ok: false, message: "OCR not available (missing @google-cloud/vision or credentials)" });
  try {
    const filePath = req.file.path;
    const [result] = await visionClient.textDetection(filePath);
    const annotations = result.textAnnotations || [];
    const fullText = annotations.length ? annotations[0].description : "";
    // fallback: if no text, return error
    if (!fullText) return res.status(400).json({ ok: false, message: "No text detected in image" });

    // Parse text into initial entries
    const parsed = parseTextToEntries(fullText);

    // Run allocator to normalize and allocate times (uses GOOGLE_MAPS_API_KEY if set)
    const googleKey = process.env.GOOGLE_MAPS_API_KEY || null;
    const tz = process.env.TZ || "America/New_York";
    const allocated = await allocateTimesAcrossAddresses(parsed, googleKey, { tz });

    const draftId = Date.now().toString();
    store.parsedDrafts.push({ id: draftId, timestamp: new Date(), entries: allocated });
    return res.json({ ok: true, draftId, entries: allocated, previewText: fullText.slice(0, 2000) });
  } catch (err) {
    console.error("OCR parse error:", err);
    return res.status(500).json({ ok: false, message: err.message || "OCR parse failed" });
  }
});

// Upload plain text and parse
app.post("/api/parse/text", async (req, res) => {
  try {
    const text = req.body.text || (req.file && fs.readFileSync(req.file.path, "utf8"));
    if (!text) return res.status(400).json({ ok: false, message: "text required in body or uploaded file" });

    const parsed = parseTextToEntries(text || "");

    const googleKey = process.env.GOOGLE_MAPS_API_KEY || null;
    const tz = process.env.TZ || "America/New_York";
    const allocated = await allocateTimesAcrossAddresses(parsed, googleKey, { tz });

    const draftId = Date.now().toString();
    store.parsedDrafts.push({ id: draftId, timestamp: new Date(), entries: allocated });
    return res.json({ ok: true, draftId, entries: allocated });
  } catch (err) {
    console.error("Text parse error:", err);
    return res.status(500).json({ ok: false, message: err.message || "Text parse failed" });
  }
});

// Preview endpoint (keeps earlier behavior)
app.post("/api/preview", async (req, res) => {
  try {
    const { entries } = req.body;
    if (!entries || !Array.isArray(entries)) return res.status(400).json({ ok: false, message: "entries required" });
    const googleKey = process.env.GOOGLE_MAPS_API_KEY || null;
    const tz = process.env.TZ || "America/New_York";
    const allocated = await allocateTimesAcrossAddresses(entries, googleKey, { tz });
    const draftId = Date.now().toString();
    store.parsedDrafts.push({ id: draftId, timestamp: new Date(), entries: allocated });
    return res.json({ ok: true, draftId, entries: allocated });
  } catch (err) {
    console.error("Preview error:", err);
    return res.status(500).json({ ok: false, message: err.message || "Preview failed" });
  }
});

// Helper to compute Monday ISO (week start) for a date string YYYY-MM-DD
function mondayOf(dateISO) {
  const d = new Date(dateISO + "T00:00:00.000Z");
  const day = d.getUTCDay(); // 0=Sun
  const diff = (day === 0 ? -6 : 1) - day; // shift to Monday
  const monday = new Date(d.getTime() + diff * 24 * 3600 * 1000);
  return monday.toISOString().slice(0,10);
}

// Export single worker for a week — now returns rowCount and fileSize and auto-selects week if not provided
app.post("/api/export", async (req, res) => {
  try {
    const { draftId, worker } = req.body;
    let { weekStartISO } = req.body;
    if (!draftId) return res.status(400).json({ ok: false, message: "draftId required" });
    const draft = store.parsedDrafts.find(d => d.id === draftId);
    if (!draft) return res.status(404).json({ ok: false, message: "Draft not found" });

    // If weekStartISO not provided, auto-select Monday of earliest date for that worker (or earliest draft entry)
    if (!weekStartISO) {
      const entriesForWorker = draft.entries.filter(e => !worker || e.worker === worker).filter(e => e.date);
      if (entriesForWorker.length) {
        const sorted = entriesForWorker.slice().sort((a,b) => (a.date > b.date ? 1 : -1));
        weekStartISO = mondayOf(sorted[0].date);
      } else {
        // fallback to today Monday
        weekStartISO = mondayOf(new Date().toISOString().slice(0,10));
      }
    }

    // generate file
    const filepath = await generateWorkerExcel(draft.entries, worker, weekStartISO, { outDir: OUTPUT_DIR });
    if (!filepath) return res.status(500).json({ ok: false, message: "Exporter failed to produce file" });

    const filename = path.basename(filepath);
    const url = `/output/${filename}`;
    let fileSize = 0;
    try {
      const st = fs.statSync(filepath);
      fileSize = st.size;
    } catch (err) {
      console.warn("Could not stat output file:", err && err.message);
    }

    // Count rows included in export by re-loading the file via exporter filter logic (or count from generate result)
    // Here, read the xlsx quickly using exceljs or simply compute rows by filtering entries
    const rowCount = draft.entries.filter(e => {
      if (!e.date) return false;
      const d = new Date(e.date + "T00:00:00.000Z");
      const start = new Date(weekStartISO + "T00:00:00.000Z");
      const end = new Date(start.getTime() + 6 * 24 * 3600 * 1000 + (23*3600+59*60+59)*1000);
      return d >= start && d <= end && (!worker || e.worker === worker);
    }).length;

    return res.json({ ok: true, downloadUrl: url, filename, fileSize, rowCount });
  } catch (err) {
    console.error("Export error:", err);
    return res.status(500).json({ ok: false, message: err.message || "Export failed" });
  }
});

// small env check route (safe)
app.get("/_env_check", (req, res) => {
  res.json({ ok: true, googleMapsKeySet: !!process.env.GOOGLE_MAPS_API_KEY, tz: process.env.TZ || null, visionAvailable: !!visionClient });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
