/**
 * browserHelper.js
 * --------------------------------------------------------------------------
 * Guarantees Chromium launch across all cloud environments (Render, local, etc.).
 *
 * Ensures PLAYWRIGHT_BROWSERS_PATH=0 is respected so browsers stored in
 * node_modules/.local-browsers are used (which Render preserves across runs).
 * If missing, automatically self-installs on-the-fly.
 */

if (process.env.PLAYWRIGHT_BROWSERS_PATH === undefined) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = '0';
}

const fs = require('fs');
const { execSync } = require('child_process');
const { chromium } = require('playwright');

let isInstalling = false;

function ensureBrowserInstalled() {
  try {
    const execPath = chromium.executablePath();
    if (fs.existsSync(execPath)) return;
  } catch (_) {}

  if (isInstalling) return;
  isInstalling = true;
  try {
    console.log('[browserHelper] Chromium executable missing. Installing Playwright Chromium to node_modules...');
    execSync('npx playwright install chromium', {
      stdio: 'inherit',
      env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: '0' },
    });
    console.log('[browserHelper] Chromium installation complete.');
  } catch (err) {
    console.error('[browserHelper] Failed to install Chromium on demand:', err.message);
  } finally {
    isInstalling = false;
  }
}

async function launchChromium(options = {}) {
  ensureBrowserInstalled();
  try {
    return await chromium.launch(options);
  } catch (err) {
    if (err.message && err.message.includes("Executable doesn't exist")) {
      console.warn('[browserHelper] Executable missing on launch. Retrying installation...');
      ensureBrowserInstalled();
      return await chromium.launch(options);
    }
    throw err;
  }
}

module.exports = {
  launchChromium,
  chromium,
};
