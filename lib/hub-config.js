'use strict';

const fs = require('node:fs');
const path = require('node:path');

function serializeConfig(config) {
  return `${JSON.stringify(config, null, 2)}\n`;
}

function writeConfigFile(file, config) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, serializeConfig(config));
}

module.exports = { serializeConfig, writeConfigFile };
