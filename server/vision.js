// vision.js - wrapper for OCR parsing
// If GOOGLE_APPLICATION_CREDENTIALS is set or VISION_SERVICE_ACCOUNT_JSON env var present, this will call Google Vision.
// Otherwise returns a small mocked parse result for the uploaded image so you can test flows.

const fs = require("fs");
const path = require("path");

async function parseOcrImages(imagePath) {
  // If Google Vision credentials not present, return a mocked parse for testing
  const useGoogle = !!process.env.GOOGLE_APPLICATION_CREDENTIALS || !!process.env.VISION_SERVICE_ACCOUNT_JSON;
  if (!useGoogle) {
    // Return a very small mock parse so frontend can be tested without credentials
    return {
      rawText: "MOCK OCR: 1513 Lafayette\\n9:00-5:30\\nChecked water pressure\\nMaterials: $10",
      fields: [
        { date: null, address: "1513 Lafayette", unit: "", start: "09:00", end: "17:30", totalHours: null, worker: null, materials: 10, notes: "Checked water pressure" }
      ]
    };
  }

  // Real Google Vision flow
  const vision = require("@google-cloud/vision");
  let client;
  if (process.env.VISION_SERVICE_ACCOUNT_JSON) {
    const json = JSON.parse(process.env.VISION_SERVICE_ACCOUNT_JSON);
    client = new vision.ImageAnnotatorClient({ credentials: json });
  } else {
    client = new vision.ImageAnnotatorClient(); // uses GOOGLE_APPLICATION_CREDENTIALS env var path
  }

  const [result] = await client.documentTextDetection(imagePath);
  const fullText = result.fullTextAnnotation ? result.fullTextAnnotation.text : "";
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
      current.notes = (current.notes ? current.notes + " " : "") + line;
    }
  }
  if (Object.keys(current).length) fields.push(current);
  return { rawText: fullText, fields };
}

module.exports = { parseOcrImages };
