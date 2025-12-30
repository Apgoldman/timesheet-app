const fs = require('fs');
const path = require('path');

// Require the exporter module from the server folder
const { generateWorkerExcel } = require('./server/exporter');

(async () => {
  try {
    // Read the preview payload you already have
    const previewPath = path.join(__dirname, 'preview_payload.json');
    if (!fs.existsSync(previewPath)) {
      throw new Error('preview_payload.json not found in project root');
    }
    const preview = JSON.parse(fs.readFileSync(previewPath, 'utf8'));

    // exporter expects either an array or an object with .entries
    const allEntries = Array.isArray(preview) ? preview : (preview.entries || preview);

    // Call the exporter directly for worker "Chris" and weekStartISO "2025-12-29"
    const result = await generateWorkerExcel(allEntries, 'Chris', '2025-12-29');

    // Print result
    console.log('EXPORT RESULT:');
    console.log(JSON.stringify(result, null, 2));

    if (result && result.ok && result.path) {
      console.log('Saved file at:', result.path);
    } else if (result && result.ok && result.filename) {
      console.log('Saved file filename:', result.filename, 'under output/');
    } else {
      console.error('Export did not succeed:', result);
      process.exit(2);
    }
  } catch (err) {
    console.error('ERROR running exporter directly:');
    console.error(err && err.stack ? err.stack : err);
    process.exit(1);
  }
})();