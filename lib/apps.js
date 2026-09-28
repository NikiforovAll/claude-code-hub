'use strict';

// Built-in apps in their default tab order.
const APPS = [
  { id: 'kanban', dir: 'cck', pkg: 'claude-code-kanban', name: 'Kanban', icon: 'columns', port: 3541 },
  { id: 'marketplace', dir: 'marketplace', pkg: 'claude-code-marketplace', name: 'Marketplace', icon: 'store', port: 3542 },
  { id: 'cost', dir: 'cost', pkg: 'claude-code-cost', name: 'Cost', icon: 'dollar-sign', port: 3543 },
  { id: 'memory', dir: 'memory', pkg: 'claude-code-memory-explorer', name: 'Memory Diagnoser', icon: 'database', port: 3544 },
];

// `entries` is the hand-edited `apps` list in config.json. Listed apps come first in list order and
// unlisted ones follow in default order, so an app added in a later release shows up without an edit.
function selectApps(entries = []) {
  const listed = entries.filter((e) => typeof e?.id === 'string');
  const byId = (id) => APPS.find((a) => a.id === id);
  const unknown = listed.map((e) => e.id).filter((id) => !byId(id));
  const off = new Set(listed.filter((e) => e.enabled === false).map((e) => e.id));
  const order = new Set([...listed.map((e) => e.id), ...APPS.map((a) => a.id)]);
  const apps = [...order].map(byId).filter((a) => a && !off.has(a.id));
  return { apps, unknown };
}

module.exports = { selectApps };
