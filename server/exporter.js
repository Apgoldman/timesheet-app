const fs = require('fs');
const path = require('path');

// Try to load exceljs if available; otherwise we'll fall back to CSV.
let ExcelJS = null;
try {
  ExcelJS = require('exceljs');
} catch (err) {
  ExcelJS = null;
}

/**
 * Generate an export for a single worker for a given week.
 * - allEntries may be an array, or an object with an `entries` array.
 * - Returns an object: { ok: true, filename, downloadUrl, path } on success.
 */
async function generateWorkerExcel(allEntries, workerName, weekStartISO) {
  // Normalize allEntries to an array
  const entriesList = Array.isArray(allEntries)
    ? allEntries
    : (allEntries && Array.isArray(allEntries.entries))
      ? allEntries.entries
      : [];

  // Filter by worker (case-insensitive)
  const entries = entriesList.filter(e =>
    (e && (e.worker || "") || "").toString().toLowerCase() === (workerName || "").toString().toLowerCase()
  );

  // Ensure output directory exists
  const outputDir = path.join(__dirname, '..', 'output');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  // Safe filename
  const safeWorker = (workerName || 'worker').replace(/[^\w\-]/g, '_');
  const week = (weekStartISO || new Date().toISOString().slice(0, 10)).replace(/[^\d\-]/g, '');
  const ext = ExcelJS ? '.xlsx' : '.csv';
  const filename = `${safeWorker}_week_${week}${ext}`;
  const filepath = path.join(outputDir, filename);

  try {
    if (ExcelJS) {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Timesheet');

      // Header row
      sheet.addRow(['Date', 'Start', 'End', 'Total Hours', 'Address', 'Unit', 'Materials', 'Notes']);

      // Data rows
      for (const e of entries) {
        sheet.addRow([
          e.date || '',
          e.start || '',
          e.end || '',
          typeof e.totalHours !== 'undefined' ? e.totalHours : '',
          e.address || '',
          e.unit || '',
          typeof e.materials !== 'undefined' ? e.materials : '',
          e.notes || ''
        ]);
      }

      await workbook.xlsx.writeFile(filepath);
    } else {
      // CSV fallback
      const rows = [];
      rows.push(['Date', 'Start', 'End', 'Total Hours', 'Address', 'Unit', 'Materials', 'Notes']);
      for (const e of entries) {
        rows.push([
          e.date || '',
          e.start || '',
          e.end || '',
          typeof e.totalHours !== 'undefined' ? e.totalHours : '',
          e.address || '',
          e.unit || '',
          typeof e.materials !== 'undefined' ? e.materials : '',
          e.notes || ''
        ]);
      }
      const csv = rows
        .map(cols => cols.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
        .join('\n');
      fs.writeFileSync(filepath, csv, 'utf8');
    }

    return { ok: true, filename, downloadUrl: `/download/${filename}`, path: filepath };
  } catch (err) {
    // Return structured error instead of throwing so the server can handle it gracefully
    return { ok: false, message: err && err.message ? err.message : String(err) };
  }
}

module.exports = { generateWorkerExcel };