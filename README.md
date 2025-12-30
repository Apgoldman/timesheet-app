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
