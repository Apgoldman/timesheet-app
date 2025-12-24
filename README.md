{
  "name": "weekly-timesheet-app",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "start": "node server/index.js",
    "dev": "nodemon server/index.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "multer": "^1.4.5",
    "xlsx": "^0.18.5",
    "luxon": "^3.4.0",
    "@google-cloud/vision": "^4.6.0",
    "@googlemaps/google-maps-services-js": "^3.3.16"
  },
  "devDependencies": {
    "nodemon": "^2.0.22"
  }
}
