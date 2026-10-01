'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const markdown = require('../public/markdown');

test('shows raw HTML as text', () => {
  const html = markdown('<img src=x onerror=alert(1)> and <script>alert(1)</script>');
  assert.doesNotMatch(html, /<img|<script/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test('keeps only http, https and mailto links', () => {
  assert.equal(
    markdown('[docs](https://example.com/a_b_c?x=1&y=2)'),
    '<p><a href="https://example.com/a_b_c?x=1&amp;y=2" target="_blank" rel="noopener noreferrer">docs</a></p>',
  );
  assert.equal(markdown('[click](javascript:void)'), '<p>click</p>');
  assert.doesNotMatch(markdown('[click](javascript:alert(1))'), /href/);
  assert.doesNotMatch(markdown('[x](https://a.com/"onmouseover="alert(1))'), /"onmouseover/);
});

test('renders code, emphasis, headings, lists, quotes and tables', () => {
  assert.equal(
    markdown('Run `npm *test*` **now**, _please_'),
    '<p>Run <code>npm *test*</code> <strong>now</strong>, <em>please</em></p>',
  );
  assert.equal(markdown('```js\nconst a = 1 < 2;\n```'), '<pre><code>const a = 1 &lt; 2;</code></pre>');
  assert.equal(markdown('## Plan'), '<h4>Plan</h4>');
  assert.equal(
    markdown('- one\n  - nested\n- two\n\n1. first'),
    '<ul><li>one<ul><li>nested</li></ul></li><li>two</li></ul><ol><li>first</li></ol>',
  );
  assert.equal(markdown('> said'), '<blockquote><p>said</p></blockquote>');
  assert.equal(
    markdown('| a | b |\n|---|---|\n| 1 | `2` |'),
    '<div class="md-table"><table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td><code>2</code></td></tr></tbody></table></div>',
  );
});

test('leaves snake_case and lone stars alone, and survives an open fence', () => {
  assert.equal(markdown('call my_var_name with 2 * 3'), '<p>call my_var_name with 2 * 3</p>');
  assert.equal(markdown('```\nunfinished'), '<pre><code>unfinished</code></pre>');
});
