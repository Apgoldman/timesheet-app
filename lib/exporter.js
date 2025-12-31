/* lib/exporter.js
   generateWorkerExcel(entries, worker, weekStartISO, options)
*/
const path = require("path");
const fs = require("fs");
const ExcelJS = require("exceljs");
const { computePayForRow } = require("./payroll");

async function generateWorkerExcel(entries, worker, weekStartISO, options = {}) {
  const outDir = options.outDir || path.join(__dirname, "..", "output");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const start = new Date(weekStartISO + "T00:00:00.000Z");
  const end = new Date(start.getTime() + 6 * 24 * 3600 * 1000 + (23*3600+59*60+59)*1000);

  const filtered = entries.filter(e => {
    if (!e.date) return false;
    const d = new Date(e.date + "T00:00:00.000Z");
    return d >= start && d <= end && (!worker || (e.worker && e.worker === worker));
  });

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Timesheet");

  sheet.columns = [
    { header: "Date", key: "date", width: 14 },
    { header: "Address", key: "address", width: 40 },
    { header: "Unit #", key: "unit", width: 10 },
    { header: "Start Time", key: "start", width: 12 },
    { header: "End Time", key: "end", width: 12 },
    { header: "Total Hours", key: "hours", width: 12 },
    { header: "Worker", key: "worker", width: 15 },
    { header: "Worker Pay", key: "pay", width: 14 },
    { header: "Description", key: "desc", width: 40 },
    { header: "Materials Cost", key: "materials", width: 14 }
  ];

  for (const r of filtered) {
    const totalHours = Number(r.totalHours || 0);
    const pay = computePayForRow({ date: r.date, totalHours, worker: r.worker }, process.env.TZ || options.tz || "America/New_York");
    sheet.addRow({
      date: r.date,
      address: r.address || "",
      unit: r.unit || "",
      start: r.start || "",
      end: r.end || "",
      hours: totalHours,
      worker: r.worker || "",
      pay,
      desc: r.description || r.notes || "",
      materials: r.materials != null ? Number(r.materials) : ""
    });
  }

  sheet.autoFilter = 'A1:J1';
  sheet.getRow(1).font = { bold: true };

  const safeWorker = (worker || "worker").replace(/\s+/g, "-").toLowerCase();
  const filename = `timesheet-${safeWorker}-${weekStartISO}.xlsx`;
  const outPath = path.join(outDir, filename);

  await workbook.xlsx.writeFile(outPath);
  return outPath;
}

module.exports = { generateWorkerExcel };
