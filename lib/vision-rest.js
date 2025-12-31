/* lib/vision-rest.js
   Helper to call Google Vision REST API using an API key (no service account needed).
   Exports: detectTextWithApiKey(filePath, apiKey) => returns fullText (string)
*/
const fs = require("fs");
const axios = require("axios");

async function detectTextWithApiKey(filePath, apiKey) {
  if (!filePath || !apiKey) throw new Error("filePath and apiKey required");
  const b = fs.readFileSync(filePath);
  const content = b.toString("base64");
  const url = `https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(apiKey)}`;

  const body = {
    requests: [
      {
        image: { content },
        features: [
          { type: "DOCUMENT_TEXT_DETECTION", maxResults: 1 },
          { type: "TEXT_DETECTION", maxResults: 1 }
        ]
      }
    ]
  };

  const resp = await axios.post(url, body, { timeout: 20000 });
  const r = resp.data && resp.data.responses && resp.data.responses[0];
  if (!r) return "";
  // Prefer fullTextAnnotation (DOCUMENT_TEXT_DETECTION), fallback to textAnnotations[0].description
  const full = (r.fullTextAnnotation && r.fullTextAnnotation.text) || (r.textAnnotations && r.textAnnotations[0] && r.textAnnotations[0].description) || "";
  return full;
}

module.exports = { detectTextWithApiKey };
