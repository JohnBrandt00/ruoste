// @ts-check
'use strict';
/** A small GitHub-flavoured markdown renderer for issue and comment bodies.
 *
 *  Deliberately not a full implementation: this renders what people actually
 *  write in issues — headings, fences, lists, task boxes, tables of links —
 *  and nothing else. The alternative, GitHub's /markdown endpoint, would cost
 *  a request per body and put remote HTML inside the webview; this escapes
 *  everything up front instead, so no input can produce markup we did not
 *  write ourselves. */

/** @param {string} s @returns {string} */
function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Only schemes that cannot execute. Everything is escaped by the time we get
 *  here, so `javascript&#58;` style smuggling is already dead; this is the
 *  second lock. @param {string} url @returns {string|null} */
function safeUrl(url) {
  const u = String(url || '').trim();
  if (/^(https?:\/\/|mailto:)/i.test(u)) return u;
  if (/^#/.test(u)) return null;
  return null;
}

/** @param {string} text @param {{repoUrl?:string, host?:string}} [o] @returns {string} */
function inline(text, o = {}) {
  /** @type {string[]} */ const code = [];
  let s = String(text);

  // protect code spans first — nothing inside them is markup
  s = s.replace(/`([^`\n]+)`/g, (_m, body) => `\u0000${code.push(`<code>${body}</code>`) - 1}\u0000`);

  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, (m, alt, url) => {
    const safe = safeUrl(url);
    return safe ? `<a class="img" href="${safe}">🖼 ${alt || 'image'}</a>` : m;
  });
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, (m, label, url) => {
    const safe = safeUrl(url);
    return safe ? `<a href="${safe}">${label}</a>` : m;
  });
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<>()]+)/g, (_m, pre, url) => `${pre}<a href="${url}">${url}</a>`);

  if (o.repoUrl) s = s.replace(/(^|[\s(])#(\d+)\b/g,
    (_m, pre, n) => `${pre}<a href="${o.repoUrl}/issues/${n}">#${n}</a>`);
  if (o.host) s = s.replace(/(^|[\s(])@([A-Za-z0-9][\w-]{0,38})\b/g,
    (_m, pre, who) => `${pre}<a href="https://${o.host}/${who}">@${who}</a>`);

  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*\w])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  s = s.replace(/(^|[^_\w])_([^_\n]+)_/g, '$1<em>$2</em>');

  return s.replace(/\u0000(\d+)\u0000/g, (_m, i) => code[Number(i)]);
}

/** @param {string} src @param {{repoUrl?:string, host?:string}} [o] @returns {string} */
function renderMarkdown(src, o = {}) {
  const text = escapeHtml(String(src ?? '').replace(/\r\n?/g, '\n'));
  if (!text.trim()) return '<p class="empty">No description.</p>';
  const lines = text.split('\n');
  /** @type {string[]} */ const out = [];
  /** @type {string[]} */ const para = [];
  /** @type {null|'ul'|'ol'} */ let list = null;

  const flushPara = () => {
    if (!para.length) return;
    out.push(`<p>${inline(para.join('\n'), o).replace(/\n/g, '<br>')}</p>`);
    para.length = 0;
  };
  const flushList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  /** @param {'ul'|'ol'} kind */
  const openList = (kind) => { if (list !== kind) { flushList(); out.push(`<${kind}>`); list = kind; } };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const fence = /^\s*(```|~~~)(.*)$/.exec(line);
    if (fence) {
      flushPara(); flushList();
      const mark = fence[1];
      /** @type {string[]} */ const body = [];
      for (i++; i < lines.length && !new RegExp(`^\s*${mark}\s*$`).test(lines[i]); i++) body.push(lines[i]);
      const lang = fence[2].trim().split(/\s+/)[0].replace(/[^\w.+-]/g, '');
      out.push(`<pre${lang ? ` data-lang="${lang}"` : ''}><code>${body.join('\n')}</code></pre>`);
      continue;
    }

    if (!line.trim()) { flushPara(); flushList(); continue; }

    if (/^\s*(?:[-*_]\s*){3,}$/.test(line)) { flushPara(); flushList(); out.push('<hr>'); continue; }

    const head = /^(#{1,6})\s+(.*)$/.exec(line);
    if (head) {
      flushPara(); flushList();
      const level = Math.min(6, head[1].length + 1);   // an h1 in a body is not the page title
      out.push(`<h${level}>${inline(head[2], o)}</h${level}>`);
      continue;
    }

    const quote = /^\s*&gt;\s?(.*)$/.exec(line);
    if (quote) {
      flushPara(); flushList();
      /** @type {string[]} */ const body = [quote[1]];
      while (i + 1 < lines.length && /^\s*&gt;\s?/.test(lines[i + 1]))
        body.push(lines[++i].replace(/^\s*&gt;\s?/, ''));
      out.push(`<blockquote>${inline(body.join('\n'), o).replace(/\n/g, '<br>')}</blockquote>`);
      continue;
    }

    const item = /^\s*(?:[-*+]|(\d+)[.)])\s+(.*)$/.exec(line);
    if (item) {
      flushPara();
      openList(item[1] ? 'ol' : 'ul');
      const task = /^\[( |x|X)\]\s+(.*)$/.exec(item[2]);
      if (task) out.push(`<li class="task"><span class="box">${task[1] === ' ' ? '☐' : '☑'}</span> ${inline(task[2], o)}</li>`);
      else out.push(`<li>${inline(item[2], o)}</li>`);
      continue;
    }

    flushList();
    para.push(line);
  }
  flushPara(); flushList();
  return out.join('\n');
}

module.exports = { renderMarkdown, escapeHtml, safeUrl, inline };
