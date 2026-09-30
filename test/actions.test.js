'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { describe, it } = require('node:test');
const { actionTable } = require('../lib/actions');

const app = (id, handles) => ({ id, actions: { handles } });

describe('actionTable', () => {
  it('gives each action to the first app in tab order', () => {
    const table = actionTable(
      [
        app('kanban', {}),
        app('cost', { 'session.cost': { params: { session: 'string?' }, url: '?s={session}', mode: 'message' } }),
        app('memory', { 'session.cost': { url: '?other' }, 'project.memory': { params: { project: 'string' } } }),
      ],
      () => {},
    );
    assert.deepEqual(table, {
      'session.cost': { app: 'cost', params: { session: 'string?' }, url: '?s={session}', mode: 'message' },
      'project.memory': { app: 'memory', params: { project: 'string' }, url: undefined, mode: 'url' },
    });
  });

  it('skips a bad declaration with a log line, and a later app can take the name', () => {
    const logs = [];
    const table = actionTable(
      [
        app('a', {
          'hub.shortcuts': {},
          'x.hash': { url: '?a#b' },
          'x.mode': { mode: 'push' },
          'x.type': { params: { n: 'number' } },
          'x.url': { url: 5 },
          'x.null': null,
        }),
        app('b', { 'x.hash': { url: '?ok' } }),
      ],
      (line) => logs.push(line),
    );
    assert.deepEqual(Object.keys(table), ['x.hash']);
    assert.equal(table['x.hash'].app, 'b');
    assert.equal(logs.length, 6);
    assert.match(logs[0], /^a: action "hub.shortcuts" uses the hub. prefix, skipped$/);
  });

  it('takes an app with no actions', () => {
    assert.deepEqual(actionTable([{ id: 'a', actions: {} }, { id: 'b' }]), {});
    const logs = [];
    assert.deepEqual(actionTable([app('a', ['x']), app('b', 'x')], (line) => logs.push(line)), {});
    assert.equal(logs.length, 2);
  });
});

describe('hub page params and url', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const fn = (name) => new RegExp(`^function ${name}\\([^)]*\\) \\{[\\s\\S]*?^\\}`, 'm').exec(src)[0];
  const { badParams, fillUrl } = vm.runInNewContext(
    `${fn('isPlainObject')}\n${fn('badParams')}\n${fn('fillUrl')}\n({ badParams, fillUrl })`,
  );
  const declared = { session: 'string?', project: 'string' };

  it('answers bad-params for a missing required param, an extra param or a value that is not a string', () => {
    assert.equal(badParams(declared, { project: 'p' }), false);
    assert.equal(badParams(declared, { project: 'p', session: 's' }), false);
    assert.equal(badParams(declared, { session: 's' }), true);
    assert.equal(badParams(declared, { project: 'p', other: 'x' }), true);
    assert.equal(badParams(declared, { project: 1 }), true);
    assert.equal(badParams(declared, { project: 'p', constructor: 'x' }), true);
    assert.equal(badParams({}, {}), false);
    assert.equal(badParams({}, null), true);
    assert.equal(badParams({}, ['x']), true);
  });

  it('fills the template with encoded values, and gives null when a param is missing', () => {
    assert.equal(fillUrl('?view=detail&session={session}', { session: 'a b&c/#' }), '?view=detail&session=a%20b%26c%2F%23');
    assert.equal(fillUrl('?view=detail&session={session}', {}), null);
    assert.equal(fillUrl('?view=list', {}), '?view=list');
  });
});
