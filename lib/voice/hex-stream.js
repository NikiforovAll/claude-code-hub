'use strict';

// Live speech through the Hex app's local API (/streams): the hub page sends mic audio, Hex sends
// partial text back. The bearer token and the stream's owner token stay in the hub.
const fs = require('node:fs');
const path = require('node:path');

const SAMPLE_RATE = 16000;
// Hex drops a stream whose lease (10 s) runs out with no call.
const HEARTBEAT_MS = 4000;

function readApi(file) {
  try {
    const api = JSON.parse(fs.readFileSync(file, 'utf8'));
    return api.port && api.token ? api : null;
  } catch {
    return null;
  }
}

const failOf = (r) => ({ ok: false, error: r.json.error || `Hex answered ${r.status}` });

function createHexStream({ apiFile = path.join(process.env.APPDATA || '', 'hex', 'local-api.json'), fetchImpl = fetch } = {}) {
  let live = null;

  async function call(method, url, { headers = {}, body, signal } = {}) {
    const r = await fetchImpl(url, { method, headers, body, signal });
    const text = await r.text();
    let json = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {}
    return { status: r.status, ok: r.ok, json };
  }

  function textOf(s) {
    const done = s.segments.filter((t, i) => t && i < s.current);
    return [...done, s.partial].filter(Boolean).join(' ').trim();
  }

  function onEvent(s, e) {
    if (e.type === 'partial') {
      s.current = e.segment;
      s.partial = `${e.stable ?? ''}${e.tentative ?? ''}`;
    } else if (e.type === 'segment') {
      s.segments[e.segment] = e.text;
      if (e.segment >= s.current) {
        s.current = e.segment + 1;
        s.partial = '';
      }
    }
    s.text = textOf(s);
  }

  async function listen(s) {
    try {
      const r = await fetchImpl(`${s.base}/streams/${s.id}/events`, { headers: s.headers, signal: s.abort.signal });
      const dec = new TextDecoder();
      let buf = '';
      for await (const chunk of r.body) {
        buf += dec.decode(chunk, { stream: true });
        let i = buf.indexOf('\n\n');
        while (i >= 0) {
          const data = buf.slice(0, i).split('\n').find((l) => l.startsWith('data:'));
          buf = buf.slice(i + 2);
          if (data) {
            try {
              onEvent(s, JSON.parse(data.slice(5)));
            } catch {}
          }
          i = buf.indexOf('\n\n');
        }
      }
    } catch {}
  }

  function end(s) {
    clearInterval(s.heartbeat);
    s.abort.abort();
    if (live === s) live = null;
  }

  // {ok, unsupported?}: unsupported means fall back to the CLI (no local API, or no /streams).
  async function start() {
    if (live) await cancel();
    const api = readApi(apiFile);
    if (!api) return { ok: false, unsupported: true, error: 'Hex local API not found' };
    const base = `http://127.0.0.1:${api.port}`;
    const auth = { Authorization: `Bearer ${api.token}` };
    let r;
    try {
      r = await call('POST', `${base}/streams`, {
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sampleFormat: 'f32le', sampleRate: SAMPLE_RATE }),
      });
    } catch (err) {
      return { ok: false, unsupported: true, error: err.message };
    }
    if (r.status === 404) return { ok: false, unsupported: true, error: 'Hex has no /streams' };
    if (!r.ok) return failOf(r);
    const s = {
      base,
      id: r.json.id,
      headers: { ...auth, 'X-Hex-Stream-Token': r.json.ownerToken },
      abort: new AbortController(),
      segments: [],
      current: 0,
      partial: '',
      text: '',
    };
    s.heartbeat = setInterval(() => {
      call('POST', `${base}/streams/${s.id}/heartbeat`, { headers: s.headers }).catch(() => {});
    }, HEARTBEAT_MS);
    live = s;
    listen(s);
    return { ok: true, sampleRate: SAMPLE_RATE };
  }

  async function audio(buf) {
    const s = live;
    if (!s) return { ok: false, error: 'no live stream' };
    const r = await call('POST', `${s.base}/streams/${s.id}/audio`, {
      headers: { ...s.headers, 'Content-Type': 'application/octet-stream' },
      body: buf,
    }).catch((err) => ({ ok: false, json: { error: err.message } }));
    if (!r.ok) return failOf(r);
    return { ok: true, text: s.text };
  }

  async function finish() {
    const s = live;
    if (!s) return { ok: false, error: 'no live stream' };
    try {
      const r = await call('POST', `${s.base}/streams/${s.id}/finish`, { headers: { ...s.headers, 'Content-Length': '0' } });
      if (!r.ok) return failOf(r);
      return { ok: true, text: (r.json.text ?? '').trim() };
    } catch (err) {
      return { ok: false, error: err.message };
    } finally {
      end(s);
    }
  }

  async function cancel() {
    const s = live;
    if (!s) return { ok: true };
    end(s);
    await call('POST', `${s.base}/streams/${s.id}/cancel`, { headers: s.headers }).catch(() => {});
    return { ok: true };
  }

  return { start, audio, finish, cancel };
}

module.exports = { createHexStream };
