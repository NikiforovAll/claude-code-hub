'use strict';

const { selectApps } = require('./apps');

const CONFIG_DIR_SWITCH = ['palette', 'swap'];
const DEFAULT_POOL_SIZE = 3;
const MAX_POOL_SIZE = 8;
const APP_STATES = ['shown', 'hidden', 'off'];

const validPoolSize = (n) => Number.isInteger(n) && n >= 1 && n <= MAX_POOL_SIZE;

function configDirSwitch(saved) {
  return CONFIG_DIR_SWITCH.includes(saved?.configDirSwitch) ? saved.configDirSwitch : 'palette';
}

function poolSize(saved, flag) {
  if (flag !== null && flag !== undefined) return Math.max(1, parseInt(flag, 10) || DEFAULT_POOL_SIZE);
  return validPoolSize(saved?.poolSize) ? saved.poolSize : DEFAULT_POOL_SIZE;
}

// The keys the running hub applies at once, so it keeps them in memory.
const LIVE_SETTINGS = ['configDirSwitch', 'poolSize'];

function copyLive(from, to) {
  for (const k of LIVE_SETTINGS) if (from[k] !== undefined) to[k] = from[k];
}

// Every app the `apps` list can turn on, in tab order, with the state its entry gives it.
function appSettings(entries = [], base) {
  return selectApps(entries, base, { includeOff: true }).apps.map((a) => ({
    ...a,
    state: !a.enabled ? 'off' : a.hidden ? 'hidden' : 'shown',
  }));
}

// What the running hub would do differently after a restart: the apps it spawns and how.
function appsShape(apps) {
  return JSON.stringify(apps.filter((a) => a.state !== 'off').map((a) => [a.id, a.state, a.deferredStart]));
}

// `saved` is config.json as on disk. Returns the new config, or {error}. Only the keys the
// patch names change; an app entry keeps its other fields (port, path, source).
function applySettings(saved, patch, base) {
  if (!patch || typeof patch !== 'object') return { error: 'body must be an object' };
  const next = { ...saved };
  if (patch.configDirSwitch !== undefined) {
    if (!CONFIG_DIR_SWITCH.includes(patch.configDirSwitch))
      return { error: `configDirSwitch must be one of ${CONFIG_DIR_SWITCH.join(', ')}` };
    next.configDirSwitch = patch.configDirSwitch;
  }
  if (patch.poolSize !== undefined) {
    if (!validPoolSize(patch.poolSize)) return { error: `poolSize must be an integer from 1 to ${MAX_POOL_SIZE}` };
    next.poolSize = patch.poolSize;
  }
  if (patch.app !== undefined) {
    const { id, state, deferredStart } = patch.app ?? {};
    const current = appSettings(saved.apps, base);
    if (!current.some((a) => a.id === id)) return { error: `Unknown app "${id}"` };
    if (state !== undefined && !APP_STATES.includes(state))
      return { error: `state must be one of ${APP_STATES.join(', ')}` };
    if (deferredStart !== undefined && typeof deferredStart !== 'boolean')
      return { error: 'deferredStart must be a boolean' };
    if (state === 'off' && current.every((a) => a.id === id || a.state === 'off'))
      return { error: 'At least one app must stay on' };
    let entries = Array.isArray(saved.apps) ? [...saved.apps] : [];
    // Listed apps come first, so a new entry appended at the end would move its tab. Listing
    // every app in its current order keeps the order.
    if (!entries.some((e) => e?.id === id)) {
      const others = entries.filter((e) => !current.some((a) => a.id === e?.id));
      entries = [...current.map((a) => entries.find((e) => e?.id === a.id) ?? { id: a.id }), ...others];
    }
    const i = entries.findIndex((e) => e?.id === id);
    const entry = { ...entries[i] };
    if (state !== undefined) {
      entry.enabled = state !== 'off';
      entry.hidden = state === 'hidden';
    }
    if (deferredStart !== undefined) entry.deferredStart = deferredStart;
    entries[i] = entry;
    next.apps = entries;
  }
  return { config: next };
}

module.exports = {
  copyLive,
  MAX_POOL_SIZE,
  appSettings,
  appsShape,
  applySettings,
  configDirSwitch,
  poolSize,
};
