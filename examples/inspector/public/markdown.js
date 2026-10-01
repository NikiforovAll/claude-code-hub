'use strict';

// Renders the markdown Claude writes in replies. Every character of the source is escaped before any
// markup is added, so raw HTML in a reply shows as text. Links keep only http, https and mailto URLs.
(function initMarkdown(root) {
  const esc = (s) =>
    String(s ?? '').replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
    );

  const SAFE_URL = /^(https?:\/\/|mailto:)/i;

  function inline(text) {
    const kept = [];
    const keep = (html) => `${kept.push(html) - 1}`;
    let s = esc(text)
      .replace(/`([^`]+)`/g, (_, c) => keep(`<code>${c}</code>`))
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, url) =>
        SAFE_URL.test(url) ? keep(`<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`) : label,
      );
    s = s
      .replace(/\*\*(?=\S)([^*]*?\S)\*\*/g, '<strong>$1</strong>')
      .replace(/__(?=\S)([^_]*?\S)__/g, '<strong>$1</strong>')
      .replace(/(^|[^*\w])\*(?=\S)([^*]*?\S)\*(?!\w)/g, '$1<em>$2</em>')
      .replace(/(^|[^_\w])_(?=\S)([^_]*?\S)_(?!\w)/g, '$1<em>$2</em>')
      .replace(/~~(?=\S)([^~]*?\S)~~/g, '<del>$1</del>');
    const restore = (t) => t.replace(/(\d+)/g, (_, i) => restore(kept[i]));
    return restore(s);
  }

  const FENCE = /^\s*(```|~~~)\s*([\w+-]*)\s*$/;
  const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
  const ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
  const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
  const QUOTE = /^\s*>\s?(.*)$/;
  const BLOCK_STARTS = [FENCE, HEADING, ITEM, QUOTE, RULE];
  const TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

  const cells = (line) =>
    line
      .trim()
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((c) => c.trim());

  function list(lines, i) {
    const out = [];
    const stack = [];
    while (i < lines.length) {
      const m = lines[i].match(ITEM);
      if (!m) {
        if (!lines[i].trim() || !stack.length || !/^\s+/.test(lines[i])) break;
        out.push(` ${inline(lines[i].trim())}`);
        i++;
        continue;
      }
      const indent = m[1].replace(/\t/g, '    ').length;
      const tag = /\d/.test(m[2]) ? 'ol' : 'ul';
      while (stack.length && indent < stack[stack.length - 1].indent) out.push(`</li></${stack.pop().tag}>`);
      const top = stack[stack.length - 1];
      if (!top || indent > top.indent) {
        stack.push({ indent, tag });
        out.push(`<${tag}><li>`);
      } else out.push('</li><li>');
      out.push(inline(m[3]));
      i++;
    }
    while (stack.length) out.push(`</li></${stack.pop().tag}>`);
    return [out.join(''), i];
  }

  function blocks(lines) {
    const out = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      const fence = line.match(FENCE);
      if (fence) {
        const body = [];
        i++;
        while (i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i++]);
        i++;
        out.push(`<pre><code>${esc(body.join('\n'))}</code></pre>`);
        continue;
      }
      if (!line.trim()) {
        i++;
        continue;
      }
      const h = line.match(HEADING);
      if (h) {
        const level = Math.min(6, h[1].length + 2);
        out.push(`<h${level}>${inline(h[2])}</h${level}>`);
        i++;
        continue;
      }
      if (RULE.test(line)) {
        out.push('<hr>');
        i++;
        continue;
      }
      if (ITEM.test(line)) {
        const [html, next] = list(lines, i);
        out.push(html);
        i = next;
        continue;
      }
      if (QUOTE.test(line)) {
        const body = [];
        while (i < lines.length && QUOTE.test(lines[i])) body.push(lines[i++].match(QUOTE)[1]);
        out.push(`<blockquote>${blocks(body)}</blockquote>`);
        continue;
      }
      if (line.includes('|') && TABLE_SEP.test(lines[i + 1] ?? '') && lines[i + 1].includes('-')) {
        const head = cells(line);
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(cells(lines[i++]));
        const tr = (r, tag) => `<tr>${head.map((_, k) => `<${tag}>${inline(r[k] ?? '')}</${tag}>`).join('')}</tr>`;
        out.push(
          `<div class="md-table"><table><thead>${tr(head, 'th')}</thead><tbody>${rows.map((r) => tr(r, 'td')).join('')}</tbody></table></div>`,
        );
        continue;
      }
      const para = [];
      while (i < lines.length && lines[i].trim() && !BLOCK_STARTS.some((r) => r.test(lines[i])))
        para.push(lines[i++].trim());
      out.push(`<p>${para.map(inline).join('<br>')}</p>`);
    }
    return out.join('');
  }

  function markdown(src) {
    return blocks(
      String(src ?? '')
        .replace(//g, '')
        .replace(/\r\n?/g, '\n')
        .split('\n'),
    );
  }

  markdown.esc = esc;
  if (typeof module === 'object' && module.exports) module.exports = markdown;
  else root.markdown = markdown;
})(typeof window === 'object' ? window : globalThis);
