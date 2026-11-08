/**
 * Plugin-owned settings that must survive a Harness restart.
 *
 * The one setting here, `allowLocalNetworks`, maps to OpenMAIC's
 * `ALLOW_LOCAL_NETWORKS` environment variable. It cannot be a live toggle on the
 * running server: the guard reads `process.env` inside the OpenMAIC child, and a
 * parent process cannot mutate a child's environment. So the value is persisted
 * here and applied by restarting the app child — the database is left running, so
 * no course data is touched.
 *
 * The file lives beside the embedded data directory, so deleting `runtime/`
 * resets both the courses and this setting together, which is the honest pairing.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const SETTINGS_FILE = 'settings.json';

/** The settings this plugin owns, with their defaults. */
export function defaultSettings() {
  return {
    /** OpenMAIC's `ALLOW_LOCAL_NETWORKS`: permit private/loopback provider URLs. */
    allowLocalNetworks: false,
  };
}

/** Read settings, tolerating a missing or corrupt file. */
export function readSettings(file) {
  const base = defaultSettings();
  if (!existsSync(file)) return base;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    if (parsed && typeof parsed === 'object') {
      if (typeof parsed.allowLocalNetworks === 'boolean') {
        base.allowLocalNetworks = parsed.allowLocalNetworks;
      }
    }
  } catch {
    // A corrupt file must not brick startup: fall back to defaults and let the
    // next write replace it.
  }
  return base;
}

/** Write settings atomically enough for a single-writer config file. */
export function writeSettings(file, settings) {
  const dir = dirname(file);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const next = { ...defaultSettings(), ...settings };
  writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return next;
}

/** Coerce a request body value into a strict boolean, or `undefined`. */
export function asBoolean(value) {
  if (value === true || value === 'true' || value === 1 || value === '1') return true;
  if (value === false || value === 'false' || value === 0 || value === '0') return false;
  return undefined;
}

/** Where the settings file lives for a given package directory. */
export function settingsPathFor(packageDir) {
  return join(packageDir, 'runtime', SETTINGS_FILE);
}

/**
 * The environment variable OpenMAIC reads for this setting.
 *
 * Only written when the operator turned it on: leaving it unset keeps
 * OpenMAIC's own default (refuse local targets) instead of depending on it
 * parsing "false".
 */
export function envForSettings(settings) {
  return settings.allowLocalNetworks ? { ALLOW_LOCAL_NETWORKS: 'true' } : {};
}
