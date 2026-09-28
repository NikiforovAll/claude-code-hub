const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { stripCookie } = require('../lib/cookies');

describe('stripCookie', () => {
  it('removes the named cookie and keeps the others in order', () => {
    assert.equal(stripCookie('a=1; hub_token=abc; b=2', 'hub_token'), 'a=1; b=2');
  });

  it('returns an empty string when only the named cookie is present', () => {
    assert.equal(stripCookie('hub_token=abc', 'hub_token'), '');
  });

  it('removes every copy of the named cookie', () => {
    assert.equal(stripCookie('hub_token=a;hub_token=b; c=3', 'hub_token'), 'c=3');
  });

  it('does not remove a cookie whose name only starts with the name', () => {
    assert.equal(stripCookie('hub_token_old=1; x_hub_token=2', 'hub_token'), 'hub_token_old=1; x_hub_token=2');
  });

  it('matches the name with spaces around it', () => {
    assert.equal(stripCookie(' hub_token =abc ;a=1', 'hub_token'), 'a=1');
  });

  it('returns an empty string for a missing header', () => {
    assert.equal(stripCookie(undefined, 'hub_token'), '');
  });
});
