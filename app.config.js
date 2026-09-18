const fs = require('fs');
const path = require('path');

// Android push (guardian alerts) needs Firebase Cloud Messaging compiled into
// the build. Wire in google-services.json when it is present, so a build made
// before Firebase is set up still succeeds — it just cannot receive pushes.
const GOOGLE_SERVICES = './google-services.json';

module.exports = ({ config }) => {
  if (!fs.existsSync(path.join(__dirname, GOOGLE_SERVICES))) return config;
  return {
    ...config,
    android: { ...config.android, googleServicesFile: GOOGLE_SERVICES },
  };
};
