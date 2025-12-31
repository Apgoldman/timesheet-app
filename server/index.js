// server/index.js (updated)
// Uses allocator (distance-based), payroll, and exporter modules.

const path = require("path");
const express = require("express");
const multer = require("multer");
const fs = require("fs");
const { allocateTimesAcrossAddresses } = require("../lib/allocator");
const { generateWorkerExcel } = require("../lib/exporter");

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

// In-memory store for prototype
const store = { parsedDrafts: [] };

// Upload CSV or any file — return server path and public url
app.post("/api/upload/csv", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, message: "file required" });
  const savedPath = req.file.path;
  const basename = path.basename(savedPath);
  const publicUrl = `/uploads/${basename}`;
  return res.json({ ok: true, path: savedPath, url: publicUrl, filename: basename });
});

// Preview endpoint — normalize and allocate; returns entries array and draftId
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

// Export single worker for a week
app.post("/api/export", async (req, res) => {
  try {
    const { draftId, worker, weekStartISO } = req.body;
    if (!draftId) return res.status(400).json({ ok: false, message: "draftId required" });

    const draft = store.parsedDrafts.find(d => d.id === draftId);
    if (!draft) return res.status(404).json({ ok: false, message: "Draft not found" });

    // generate file
    const outDir = path.join(__dirname, "..", "output");
    const filepath = await generateWorkerExcel(draft.entries, worker, weekStartISO, { outDir });

    if (!filepath) return res.status(500).json({ ok: false, message: "Exporter failed to produce file" });

    const filename = path.basename(filepath);
    const url = `/download/${filename}`;

    // register a download route for this generated file
    app.get(url, (req2, res2) => {
      res2.download(filepath, filename, err => {
        if (err) {
          console.error("Download error:", err);
          if (!res2.headersSent) res2.status(500).send("Download failed");
        }
      });
    });

    return res.json({ ok: true, downloadUrl: url, filename });
  } catch (err) {
    console.error("Export error:", err);
    return res.status(500).json({ ok: false, message: err.message || "Export failed" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
