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

// A missing file reads as {}. Bad JSON throws, so a caller does not write over a hand edit.
function readConfig(hubDir) {
  const file = path.join(hubDir, 'config.json');
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return { file, config: {} };
    throw e;
  }
  try {
    return { file, config: JSON.parse(raw) };
  } catch (e) {
    throw new Error(`${file}: ${e.message}`);
  }
}

module.exports = { readConfig, serializeConfig, writeConfigFile };
