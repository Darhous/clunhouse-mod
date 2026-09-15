'use strict';
// Prints the startup banner and opens the app itself plus the developer's
// Instagram + portfolio in the OS default browser once per server start —
// see LICENSE ("Attribution & Fair Use").
const { exec } = require('child_process');

const INSTAGRAM_URL = 'https://www.instagram.com/darhous/';
const PORTFOLIO_URL = 'https://darhous.github.io/portofolio/';

function printBanner(port) {
  const line = '━'.repeat(44);
  console.log(`
${line}
✓ Clubhouse mod by Darhous — Server started successfully
  http://localhost:${port}

  Free Software by Darhous
  Instagram : @darhous
  Portfolio : darhous.github.io/portofolio
${line}
`);
}

function openInDefaultBrowser(url) {
  const command = process.platform === 'win32' ? `start "" "${url}"`
    : process.platform === 'darwin' ? `open "${url}"`
    : `xdg-open "${url}"`;
  exec(command, () => {});
}

function announce(port) {
  printBanner(port);
  openInDefaultBrowser(`http://localhost:${port}/`);
  openInDefaultBrowser(INSTAGRAM_URL);
  openInDefaultBrowser(PORTFOLIO_URL);
}

module.exports = { announce };
