/**
 * Plugin-owned settings that must survive a Harness restart.
 *
 * Two settings:
 *
 * - `mode` selects where the classroom is served from: `local` runs the bundled
 *   OpenMAIC instance (embedded database, child process, loopback proxy) and
 *   `cloud` points at open.maic.chat, which the user reaches with their own
 *   account and which has its own course library. Switching is instant because it
 *   changes the URL the panel reports, not the stack.
 * - `allowLocalNetworks` maps to OpenMAIC's `ALLOW_LOCAL_NETWORKS`. It cannot be a
 *   live toggle on the running server: the guard reads `process.env` inside the
 *   OpenMAIC child, and a parent process cannot mutate a child's environment. So
 *   the value is persisted here and applied by restarting the app child — the
 *   database is left running, so no course data is touched.
 *
 * The file lives beside the embedded data directory, so deleting `runtime/`
 * resets both the courses and these settings together, which is the honest pairing.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const SETTINGS_FILE = 'settings.json';

/** The hosted OpenMAIC deployment, used when `mode` is `cloud`. */
export const CLOUD_ORIGIN = 'https://open.maic.chat';

/** The settings this plugin owns, with their defaults. */
export function defaultSettings() {
  return {
    /** `local` serves the bundled instance; `cloud` serves open.maic.chat. */
    mode: 'local',
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
      if (parsed.mode === 'local' || parsed.mode === 'cloud') {
        base.mode = parsed.mode;
      }
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

/** Coerce a request body value into `local` | `cloud`, or `undefined`. */
export function asMode(value) {
  return value === 'local' || value === 'cloud' ? value : undefined;
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
