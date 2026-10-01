'use strict';

const SUMMARY_MAX = 160;
const PROMPT_MAX = 2000;
const REPLY_MAX = 400;
const DETAIL_MAX = 64 * 1024;
const SUMMARY_KEYS = ['command', 'file_path', 'pattern', 'path', 'url', 'query', 'description', 'prompt', 'skill'];

function textOf(content, others = false) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((c) => others || c.type === 'text')
    .map((c) => (c.type === 'text' ? c.text : `[${c.type}]`))
    .join('\n');
}

// V8 keeps the whole parent string alive behind a slice, so a 64 KB slice of a 5 MB tool result holds 5 MB.
// A UTF-8 round trip makes a copy that owns only its own characters.
function own(s) {
  return Buffer.from(s, 'utf8').toString('utf8');
}

function cut(s, n) {
  return own(s.length > n ? `${s.slice(0, n - 1)}…` : s);
}

function clip(s, n = SUMMARY_MAX) {
  const one = String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return cut(one, n);
}

function cutDetail(s) {
  return s.length > DETAIL_MAX ? own(`${s.slice(0, DETAIL_MAX)}\n…`) : s;
}

// Claude Code writes its own output into user lines too: command output, hook text, background-task notices.
const WRAPPER = /^<(local-command-|system-reminder|bash-stdout|bash-stderr|task-notification|user-prompt-submit-hook)/;
const COMMAND = /<command-name>([^<]*)<\/command-name>/;
const COMMAND_ARGS = /<command-args>([\s\S]*?)<\/command-args>/;
const BASH_INPUT = /^<bash-input>([\s\S]*?)<\/bash-input>/;

function promptText(o) {
  if (o.type !== 'user' || o.isMeta || o.isSidechain || o.isCompactSummary) return null;
  const c = o.message?.content;
  if (Array.isArray(c) && c.some((b) => b.type === 'tool_result')) return null;
  const text = textOf(c).trim();
  if (text.startsWith('[Request interrupted') || WRAPPER.test(text)) return null;
  const command = text.startsWith('<command-') && text.match(COMMAND);
  if (command) return `${command[1]} ${text.match(COMMAND_ARGS)?.[1] ?? ''}`.trim();
  const bash = text.match(BASH_INPUT);
  if (bash) return `! ${bash[1].trim()}`;
  if (text) return text;
  return Array.isArray(c) && c.some((b) => b.type === 'image') ? '[Image]' : null;
}

function keptInput(input, json) {
  if (json.length > DETAIL_MAX) return { input: cutDetail(json), size: DETAIL_MAX };
  return { input, size: json.length };
}

function toolSummary(input, json) {
  if (!input || typeof input !== 'object') return '';
  for (const k of SUMMARY_KEYS) if (typeof input[k] === 'string' && input[k]) return clip(input[k]);
  return clip(json.slice(0, SUMMARY_MAX * 4));
}

function contextOf(u) {
  return (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
}

// Takes the transcript one line at a time, so a live session can be read in steps as Claude Code appends to it.
// Claude Code writes one line per content block and repeats the message's usage on each, so usage counts once per message id.
function createParser() {
  const meta = { title: null, cwd: null, gitBranch: null, model: null, version: null, started: null, updated: null };
  const turns = [];
  const tools = new Map();
  const replies = new Map();
  const seen = new Set();
  let turn = null;
  let customTitle = null;
  let aiTitle = null;
  let compactPending = false;
  let kept = 0;

  function open(o, text) {
    turn = {
      n: turns.length + 1,
      at: o.timestamp,
      prompt: cut(text, PROMPT_MAX),
      queued: o.promptSource === 'queued',
      durationMs: null,
      tools: [],
      reply: '',
      replyLong: false,
      tokens: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 },
      context: 0,
      compactedBefore: compactPending,
      interrupted: false,
    };
    compactPending = false;
    turns.push(turn);
  }

  function results(o) {
    const c = o.message?.content;
    if (textOf(c).startsWith('[Request interrupted')) turn.interrupted = true;
    if (!Array.isArray(c)) return;
    for (const b of c) {
      if (b.type !== 'tool_result') continue;
      const t = tools.get(b.tool_use_id);
      if (!t) continue;
      const text = textOf(b.content, true);
      t.ok = !b.is_error;
      t.resultBytes = Buffer.byteLength(text);
      t.result = cutDetail(text);
      kept += t.result.length;
      t.doneAt = o.timestamp ?? null;
    }
  }

  function reply(o) {
    const m = o.message || {};
    if (m.model && m.model !== '<synthetic>') meta.model = m.model;
    if (m.usage && m.id && !seen.has(m.id)) {
      seen.add(m.id);
      turn.tokens.input += m.usage.input_tokens || 0;
      turn.tokens.cacheRead += m.usage.cache_read_input_tokens || 0;
      turn.tokens.cacheWrite += m.usage.cache_creation_input_tokens || 0;
      turn.tokens.output += m.usage.output_tokens || 0;
      turn.context = contextOf(m.usage);
    }
    for (const b of m.content || []) {
      if (b.type === 'text' && b.text.trim()) {
        const text = b.text.trim();
        turn.reply = cut(text, REPLY_MAX);
        turn.replyLong = text.length > REPLY_MAX;
        const full = turn.replyLong ? cutDetail(text) : null;
        kept += (full?.length ?? 0) - (replies.get(turn.n)?.length ?? 0);
        if (full) replies.set(turn.n, full);
        else replies.delete(turn.n);
      }
      if (b.type !== 'tool_use' || tools.has(b.id)) continue;
      const json = JSON.stringify(b.input ?? null);
      const { input, size } = keptInput(b.input, json);
      kept += size;
      const t = {
        id: b.id,
        turn: turn.n,
        name: b.name,
        summary: toolSummary(b.input, json),
        input,
        at: o.timestamp ?? null,
        ok: null,
        resultBytes: 0,
        result: null,
        doneAt: null,
      };
      tools.set(b.id, t);
      turn.tools.push(t);
    }
  }

  function line(text) {
    if (!text) return;
    let o;
    try {
      o = JSON.parse(text);
    } catch {
      return;
    }
    if (!o || typeof o !== 'object') return;
    if (o.type === 'custom-title' && o.customTitle) customTitle = o.customTitle;
    if (o.type === 'ai-title' && o.aiTitle) aiTitle = o.aiTitle;
    meta.title = customTitle ?? aiTitle;
    if (o.isSidechain) return;
    if (o.cwd) meta.cwd ??= o.cwd;
    if (o.gitBranch) meta.gitBranch = o.gitBranch;
    if (o.version) meta.version = o.version;
    if (o.timestamp) {
      meta.started ??= o.timestamp;
      meta.updated = o.timestamp;
    }

    const prompt = promptText(o);
    if (o.type === 'system' && o.subtype === 'compact_boundary') compactPending = true;
    else if (o.type === 'system' && o.subtype === 'turn_duration' && turn)
      turn.durationMs = (turn.durationMs || 0) + (o.durationMs || 0);
    // After a compaction Claude Code writes the /compact command again at the start of the new context.
    else if (prompt != null && compactPending && /^\/compact\b/.test(prompt)) return;
    else if (prompt != null) open(o, prompt);
    else if (!turn) return;
    else if (o.type === 'user') results(o);
    else if (o.type === 'assistant') reply(o);
  }

  return { line, result: () => ({ meta, turns, tools, replies }), kept: () => kept };
}

function parse(raw) {
  const p = createParser();
  for (const l of raw.split('\n')) p.line(l);
  return p.result();
}

function overview({ meta, turns }) {
  const totals = {
    turns: turns.length,
    tools: 0,
    failed: 0,
    input: 0,
    cacheRead: 0,
    cacheWrite: 0,
    output: 0,
    durationMs: 0,
    peak: 0,
  };
  const list = turns.map((t) => {
    const failed = t.tools.filter((x) => x.ok === false).length;
    totals.tools += t.tools.length;
    totals.failed += failed;
    for (const k in t.tokens) totals[k] += t.tokens[k];
    totals.durationMs += t.durationMs || 0;
    totals.peak = Math.max(totals.peak, t.context);
    return { ...t, failed, tools: t.tools.map(({ input, result, turn, ...rest }) => rest) };
  });
  return { meta: { ...meta }, totals, usage: usage(turns), turns: list };
}

function usage(turns) {
  const skills = new Map();
  const servers = new Map();
  const count = (map, name, ok) => {
    const u = map.get(name) ?? { name, count: 0, failed: 0 };
    u.count++;
    if (ok === false) u.failed++;
    map.set(name, u);
  };
  for (const turn of turns)
    for (const t of turn.tools) {
      if (t.name === 'Skill' && typeof t.input?.skill === 'string') count(skills, t.input.skill, t.ok);
      const mcp = /^mcp__(.+?)__(.+)$/.exec(t.name);
      if (!mcp) continue;
      if (!servers.has(mcp[1])) servers.set(mcp[1], new Map());
      count(servers.get(mcp[1]), mcp[2], t.ok);
    }
  const ranked = (list) => list.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return {
    skills: ranked([...skills.values()]),
    mcp: ranked(
      [...servers].map(([name, tools]) => {
        const list = ranked([...tools.values()]);
        return { name, count: list.reduce((n, x) => n + x.count, 0), tools: list };
      }),
    ),
  };
}

function toolDetail({ tools }, id) {
  const t = tools.get(id);
  if (!t) return null;
  const { summary, ...detail } = t;
  return detail;
}

function replyOf({ turns, replies }, n) {
  const t = turns[n - 1];
  return t ? { n, reply: replies.get(n) ?? t.reply } : null;
}

module.exports = { createParser, parse, overview, toolDetail, replyOf };
