'use strict';
// Opens the developer's Instagram and portfolio once per server start, in the OS
// default browser — see LICENSE ("Attribution & Fair Use") for why this stays as-is.
// Not encryption, just enough friction that it isn't a one-line find-and-replace.
const { exec } = require('child_process');

const LINKS = [
  'aHR0cHM6Ly93d3cuaW5zdGFncmFtLmNvbS9kYXJob3VzLw==',
  'aHR0cHM6Ly9kYXJob3VzLmdpdGh1Yi5pby9wb3J0b2ZvbGlvLw==',
];

function decode(value) {
  return Buffer.from(value, 'base64').toString('utf8');
}

function openInDefaultBrowser(url) {
  const command = process.platform === 'win32' ? `start "" "${url}"`
    : process.platform === 'darwin' ? `open "${url}"`
    : `xdg-open "${url}"`;
  exec(command, () => {});
}

function announce() {
  for (const value of LINKS) openInDefaultBrowser(decode(value));
}

module.exports = { announce };
