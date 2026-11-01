'use strict';

// Turns a spoken task into a title and a description. Short text is the title as said. Longer text
// stays whole in the description, as said, and gets a title: written by voice.taskTitleModel when
// it is set and answers, else the words before the first sentence break, else none.
const { spawn } = require('node:child_process');
const os = require('node:os');

const MAX_TITLE_WORDS = 8;
const MAX_MODEL_TITLE_WORDS = 12;
const ASK_TIMEOUT_MS = 15000;
const BREAK = /^(.+?)[,.;:!?](?:\s|$)/;

const PROMPT =
  'You get a spoken task. Write a short title for it, 3 to 8 words, in the language of the task, using its own words where you can. No quotes, no period. Reply with the title only.';

const words = (s) => s.split(/\s+/).filter(Boolean).length;

function cleanTitle(answer) {
  const title = String(answer ?? '')
    .trim()
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .replace(/[.!]+$/, '')
    .trim();
  if (!title || title.includes('\n') || words(title) > MAX_MODEL_TITLE_WORDS) return '';
  return title;
}

// `ask(text)` answers a title; an empty, multi-line or long answer is ignored.
async function titleTask(said, ask) {
  const text = String(said ?? '').trim();
  if (words(text) <= MAX_TITLE_WORDS) return { subject: text };
  const title = ask ? cleanTitle(await ask(text).catch(() => '')) : '';
  const subject = title || (BREAK.exec(text)?.[1] ?? '');
  return { subject, description: text };
}

// One plain answer from the Claude Code CLI: no tools, MCP servers, settings, hooks or skills, the
// default system prompt replaced, and no transcript, so no session shows on the board. `configDir`
// is the hub's active one when it is not the default, so the CLI uses that dir's login.
function askClaude(text, model, configDir) {
  const env = configDir ? { ...process.env, CLAUDE_CONFIG_DIR: configDir } : process.env;
  const args = ['-p', '--model', model, '--output-format', 'json', '--tools', '', '--strict-mcp-config'];
  args.push('--setting-sources', '', '--disable-slash-commands', '--no-session-persistence', '--max-turns', '1');
  args.push('--system-prompt', PROMPT, text);
  return new Promise((resolve, reject) => {
    let child;
    try {
      // stdin closed: the CLI otherwise waits 3 s for piped input.
      child = spawn('claude', args, { cwd: os.tmpdir(), env, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    } catch (err) {
      return reject(err);
    }
    let out = '';
    const timer = setTimeout(() => child.kill(), ASK_TIMEOUT_MS);
    child.stdout.on('data', (d) => {
      out += d;
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', () => {
      clearTimeout(timer);
      try {
        const r = JSON.parse(out);
        // A failed login or API error comes back as text in `result`, flagged by is_error.
        if (r.is_error) throw new Error(String(r.result ?? 'claude failed'));
        resolve(String(r.result ?? ''));
      } catch (err) {
        reject(err);
      }
    });
  });
}

module.exports = { titleTask, askClaude };
