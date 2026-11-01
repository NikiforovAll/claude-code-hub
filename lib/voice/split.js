'use strict';

// Splits a spoken task into a subject and a description without changing a word: the subject is
// the leading words, the description the rest, as said. Short text stays whole; longer text is cut
// at the first sentence break, else, when voice.taskSplitModel is set, where that model says.
const { spawn } = require('node:child_process');
const os = require('node:os');

const MAX_WHOLE_WORDS = 8;
const ASK_TIMEOUT_MS = 15000;
const BREAK = /^(.+?)[,.;:!?](?:\s+|$)([\s\S]*)$/;
const LEAD = /^[\s,.;:!?-]+/;

const PROMPT =
  'You get a spoken task. Copy its leading words that name the task, exactly as written, character for character: same words, order, spelling and case. Do not rephrase, fix, shorten or add anything. Stop before the first detail. If the whole text is short, copy all of it. Reply with the copied words only.';

const words = (s) => s.split(/\s+/).filter(Boolean).length;

// `ask(text)` answers the leading words; an answer that is not a prefix of the text is ignored.
async function splitTask(said, ask) {
  const text = String(said ?? '').trim();
  const whole = { subject: text };
  if (words(text) <= MAX_WHOLE_WORDS) return whole;
  const cut = BREAK.exec(text);
  if (cut) return cut[2] ? { subject: cut[1], description: cut[2] } : { subject: cut[1] };
  if (!ask) return whole;
  const lead = String((await ask(text).catch(() => '')) ?? '')
    .trim()
    .replace(/[.,;:!?]+$/, '');
  if (!lead || lead === text || !text.startsWith(lead)) return whole;
  return { subject: lead, description: text.slice(lead.length).replace(LEAD, '') };
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
        resolve(String(JSON.parse(out).result ?? ''));
      } catch (err) {
        reject(err);
      }
    });
  });
}

module.exports = { splitTask, askClaude };
