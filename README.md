```markdown
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
```
