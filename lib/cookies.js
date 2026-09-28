'use strict';

// Returns the Cookie header value without the named cookie, or '' when nothing is left.
function stripCookie(header, name) {
  if (typeof header !== 'string') return '';
  return header
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part && part.split('=', 1)[0].trim() !== name)
    .join('; ');
}

module.exports = { stripCookie };
