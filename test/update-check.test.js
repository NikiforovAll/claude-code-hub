const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createUpdateCheck, isNewer } = require('../lib/update-check');

describe('isNewer', () => {
  it('compares each part as a number', () => {
    assert.equal(isNewer('1.0.10', '1.0.9'), true);
    assert.equal(isNewer('1.10.0', '1.9.9'), true);
    assert.equal(isNewer('2.0.0', '1.99.99'), true);
    assert.equal(isNewer('1.0.2', '1.0.2'), false);
    assert.equal(isNewer('1.0.1', '1.0.2'), false);
  });

  it('offers a stable release over its own prerelease', () => {
    assert.equal(isNewer('1.1.0', '1.1.0-rc.2'), true);
    assert.equal(isNewer('1.0.9', '1.1.0-rc.2'), false);
  });

  it('never offers a prerelease or a malformed version', () => {
    assert.equal(isNewer('1.1.0-rc.1', '1.0.0'), false);
    assert.equal(isNewer('latest', '1.0.0'), false);
    assert.equal(isNewer(undefined, '1.0.0'), false);
    assert.equal(isNewer('1.0.0<script>', '0.9.0'), false);
  });
});

describe('createUpdateCheck', () => {
  it('answers with the newer version and its release notes', async () => {
    const check = createUpdateCheck({ current: '1.0.2', fetch: async () => '1.0.3' });
    assert.deepEqual(await check.update(), {
      latest: '1.0.3',
      url: 'https://github.com/NikiforovAll/claude-code-hub/releases/tag/v1.0.3',
    });
  });

  it('answers null when the running version is the latest', async () => {
    const check = createUpdateCheck({ current: '1.0.2', fetch: async () => '1.0.2' });
    assert.equal(await check.update(), null);
  });

  it('answers null and stays quiet when the registry fails', async () => {
    const check = createUpdateCheck({
      current: '1.0.2',
      fetch: async () => {
        throw new Error('offline');
      },
    });
    assert.equal(await check.update(), null);
  });

  it('never fetches when off', async () => {
    let calls = 0;
    const check = createUpdateCheck({ current: '1.0.2', enabled: false, fetch: async () => (calls++, '9.0.0') });
    await check.refresh();
    assert.equal(await check.update(), null);
    assert.equal(calls, 0);
  });

  it('waits for the check in flight instead of starting another', async () => {
    let calls = 0;
    let release;
    const check = createUpdateCheck({
      current: '1.0.2',
      fetch: () => {
        calls++;
        return new Promise((r) => (release = () => r('1.0.3')));
      },
    });
    check.refresh();
    const answer = check.update();
    await new Promise(setImmediate);
    release();
    assert.equal((await answer).latest, '1.0.3');
    assert.equal(calls, 1);
  });

  it('asks the registry again only after the cache expires', async () => {
    let t = 0;
    let calls = 0;
    const versions = ['1.0.3', '1.0.4'];
    const check = createUpdateCheck({ current: '1.0.2', now: () => t, ttlMs: 1000, fetch: async () => versions[calls++] });
    assert.equal((await check.update()).latest, '1.0.3');
    t = 999;
    assert.equal((await check.update()).latest, '1.0.3');
    t = 1000;
    assert.equal((await check.update()).latest, '1.0.4');
    assert.equal(calls, 2);
  });
});
