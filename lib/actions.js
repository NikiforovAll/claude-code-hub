'use strict';

const PARAM_TYPES = new Set(['string', 'string?']);
const MODES = new Set(['url', 'message']);

function actionError(name, spec) {
  if (name.startsWith('hub.')) return 'uses the hub. prefix';
  if (typeof spec !== 'object' || spec === null) return 'is not an object';
  if (spec.url !== undefined && typeof spec.url !== 'string') return 'has a url that is not a string';
  if (spec.url?.includes('#')) return 'has a # in its url';
  if (spec.mode !== undefined && !MODES.has(spec.mode)) return `has an unknown mode ${JSON.stringify(spec.mode)}`;
  const params = spec.params ?? {};
  if (typeof params !== 'object' || Object.values(params).some((t) => !PARAM_TYPES.has(t))) {
    return 'has a param type that is not "string" or "string?"';
  }
  return null;
}

// Protocol §7: the first app in tab order that declares an action handles it.
function actionTable(apps, log = console.log) {
  const table = {};
  for (const app of apps) {
    const handles = app.actions?.handles ?? {};
    if (typeof handles !== 'object' || Array.isArray(handles)) {
      log(`${app.id}: actions.handles is not an object, skipped`);
      continue;
    }
    for (const [name, spec] of Object.entries(handles)) {
      const err = actionError(name, spec);
      if (err) log(`${app.id}: action "${name}" ${err}, skipped`);
      else if (!Object.hasOwn(table, name)) {
        table[name] = { app: app.id, params: spec.params ?? {}, url: spec.url, mode: spec.mode ?? 'url' };
      }
    }
  }
  return table;
}

module.exports = { actionTable };
