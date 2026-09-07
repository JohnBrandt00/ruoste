(function () {
  'use strict';
  const vs = acquireVsCodeApi();
  const post = (type, extra) => vs.postMessage(Object.assign({ type }, extra || {}));
  const $ = (id) => document.getElementById(id);
  const head = $('head'), strip = $('strip'), links = $('links'), desc = $('desc'),
        files = $('files'), timeline = $('timeline'), acts = $('acts'), banner = $('banner'),
        where = $('where'), chip = $('chip'), draft = $('draft');

  let state = null;
  const openPatches = new Set();          // file paths whose patch is expanded

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z]+/g, '');
  const avatar = (p) => {
    if (!p || !p.avatar) return null;
    const img = el('img', 'av');
    img.src = p.avatar; img.alt = '';
    return img;
  };

  // ── header block ──────────────────────────────────────────────────────
  function renderHead() {
    const it = state.item;
    head.textContent = '';
    chip.textContent = it.kind === 'pr' ? 'PULL REQUEST' : 'ISSUE';
    where.textContent = `${state.repo.owner}/${state.repo.name}`;

    const h = el('h1');
    h.append(document.createTextNode(it.title + ' '));
    h.append(el('span', 'num', `#${it.number}`));
    head.append(h);

    const sub = el('div', 'sub');
    sub.append(el('span', `state ${slug(it.state)}`, it.state));
    if (it.author) {
      const who = el('span');
      const av = avatar(it.author);
      if (av) who.append(av, ' ');
      who.append(document.createTextNode(it.author.login));
      sub.append(who);
    }
    sub.append(el('span', null, `opened ${it.opened}`));
    sub.append(el('span', null, `updated ${it.updated}`));
    if (it.locked) sub.append(el('span', null, 'locked'));
    head.append(sub);

    const chips = el('div', 'chips');
    for (const l of it.labels) {
      const c = el('span', 'chip');
      if (l.color) {
        const sw = el('span', 'swatch');
        sw.style.background = `#${String(l.color).replace(/[^0-9a-fA-F]/g, '')}`;
        c.append(sw);
      }
      c.append(document.createTextNode(l.name));
      chips.append(c);
    }
    const people = it.assignees.map((a) => a.login);
    chips.append(el('span', people.length ? 'chip' : 'chip empty',
      people.length ? `assigned ${people.join(', ')}` : 'unassigned'));
    if (state.pr && state.pr.reviewers.length)
      chips.append(el('span', 'chip', `reviewers ${state.pr.reviewers.join(', ')}`));
    head.append(chips);
  }

  // ── pull request strip ────────────────────────────────────────────────
  function renderStrip() {
    strip.textContent = '';
    const pr = state.pr;
    if (!pr) return;
    const box = el('div', 'strip');

    const branch = el('div');
    branch.append(el('b', null, pr.head || '?'), document.createTextNode(' → '), el('b', null, pr.base || '?'));
    if (pr.fork) branch.append(document.createTextNode(` (from ${pr.fork})`));
    box.append(branch);

    const diff = el('div');
    diff.append(el('span', 'add', `+${pr.additions}`), document.createTextNode(' '),
                el('span', 'del', `−${pr.deletions}`),
                document.createTextNode(` in ${pr.changed} file${pr.changed === 1 ? '' : 's'} · ${pr.commits} commit${pr.commits === 1 ? '' : 's'}`));
    box.append(diff);

    if (!pr.merged) {
      const m = pr.mergeable === false ? 'conflicts with base'
        : pr.mergeable === true ? `mergeable${pr.mergeableState ? ` (${pr.mergeableState})` : ''}`
        : 'merge state unknown';
      box.append(el('div', pr.mergeable === false ? 'del' : null, m));
    }

    if (pr.checks.length) {
      const wrap = el('div', 'checks');
      for (const c of pr.checks) {
        const b = el('span', 'check');
        b.append(el('span', `dot ${c.live ? 'live' : c.ok ? 'ok' : 'bad'}`));
        b.append(document.createTextNode(`${c.name} ${c.label}`));
        if (c.url) b.addEventListener('click', () => post('open', { url: c.url }));
        wrap.append(b);
      }
      box.append(wrap);
    }
    strip.append(box);
  }

  // ── linked issues and pull requests ───────────────────────────────────
  function renderLinks() {
    links.textContent = '';
    const list = state.links || [];
    if (!list.length && !state.unnamedLinks) return;

    const box = el('div', 'linked');
    box.append(el('span', 'count', state.item.kind === 'pr' ? 'linked issues' : 'linked'));
    for (const l of list) {
      const a = el('button', `link ${l.relation} ${l.state || ''}`);
      a.append(el('span', 'sym', l.kind === 'pr' ? '⑂' : '◎'));
      a.append(el('span', 'no', `#${l.number}`));
      if (!l.sameRepo) a.append(el('span', 'in', `${l.owner}/${l.repo}`));
      if (l.title) a.append(el('span', 'ttl', l.title));
      if (l.relation === 'closes') a.append(el('span', 'rel', 'closes'));
      if (l.state) a.append(el('span', `rel ${l.state}`, l.state));
      a.title = `${l.owner}/${l.repo}#${l.number}${l.title ? ` · ${l.title}` : ''}`;
      a.addEventListener('click', () =>
        post('openItem', { owner: l.owner, repo: l.repo, number: l.number }));
      box.append(a);
    }
    if (state.unnamedLinks)
      box.append(el('span', 'chip empty',
        `${state.unnamedLinks} more link${state.unnamedLinks === 1 ? '' : 's'} the API does not name`));
    links.append(box);
  }

  // ── prose blocks ──────────────────────────────────────────────────────
  function prose(html) {
    const d = el('div', 'prose');
    d.innerHTML = html;                       // built and escaped in the extension host
    for (const a of d.querySelectorAll('a')) {
      const href = a.getAttribute('href');
      a.addEventListener('click', (ev) => { ev.preventDefault(); post('open', { url: href }); });
    }
    return d;
  }

  function card(entry) {
    const c = el('article', 'card');
    const who = el('div', 'who');
    const av = avatar(entry.author);
    if (av) who.append(av);
    who.append(el('span', null, (entry.author && entry.author.login) || 'someone'));
    who.append(el('span', null, entry.when || ''));
    if (entry.edited) who.append(el('span', null, 'edited'));
    if (entry.state) {
      const tag = el('span', `tag ${entry.state.includes('approved') ? 'approved'
        : entry.state.includes('changes') ? 'changes' : ''}`, entry.state);
      who.append(tag);
    }
    c.append(who);
    c.append(prose(entry.bodyHtml || '<p class="empty">No text.</p>'));
    return c;
  }

  // ── changed files, with the patch inline ──────────────────────────────
  function patchBlock(f) {
    const pre = el('pre', 'patch');
    if (!f.patch) {
      pre.append(el('div', 'ln meta', f.binary
        ? 'Binary file — open it in the diff editor or on GitHub.'
        : 'GitHub sent no patch for this file (too large, or renamed with no changes).'));
      return pre;
    }
    for (const line of f.patch.split('\n')) {
      const c = line[0] === '+' ? 'add' : line[0] === '-' ? 'del'
        : line.startsWith('@@') ? 'hunk' : line[0] === '\\' ? 'meta' : '';
      pre.append(el('div', `ln ${c}`, line || ' '));
    }
    return pre;
  }

  function fileRow(f) {
    const wrap = el('li', 'file');
    const row = el('div', 'row');
    row.append(el('span', 'caret', openPatches.has(f.name) ? '▾' : '▸'));
    row.append(el('span', 'path', f.name));
    row.append(el('span', 'add', `+${f.additions}`));
    row.append(el('span', 'del', `−${f.deletions}`));
    row.append(el('span', 'st', f.status));

    const diff = el('button', 'mini ghost', 'DIFF');
    diff.title = 'Open in the diff editor';
    diff.addEventListener('click', (ev) => { ev.stopPropagation(); post('diff', { index: f.index }); });
    row.append(diff);

    const gh = el('button', 'mini ghost', '↗');
    gh.title = 'Open the file on GitHub';
    gh.addEventListener('click', (ev) => { ev.stopPropagation(); post('open', { url: f.url }); });
    row.append(gh);

    row.addEventListener('click', () => {
      if (openPatches.has(f.name)) openPatches.delete(f.name);
      else openPatches.add(f.name);
      renderFiles();
    });
    wrap.append(row);
    if (openPatches.has(f.name)) wrap.append(patchBlock(f));
    return wrap;
  }

  function renderFiles() {
    files.textContent = '';
    const pr = state.pr;
    if (!pr || !pr.files.length) return;

    const bar = el('div', 'filesbar');
    bar.append(el('span', 'count',
      `${pr.files.length} changed file${pr.files.length === 1 ? '' : 's'}` +
      (pr.truncated ? ` (+${pr.truncated} more on GitHub)` : '')));
    const all = el('button', 'mini', 'OPEN ALL DIFFS');
    all.addEventListener('click', () => post('diffAll'));
    bar.append(all);
    const expand = el('button', 'mini ghost',
      openPatches.size ? 'COLLAPSE PATCHES' : 'EXPAND PATCHES');
    expand.addEventListener('click', () => {
      if (openPatches.size) openPatches.clear();
      else for (const f of pr.files) openPatches.add(f.name);
      renderFiles();
    });
    bar.append(expand);
    files.append(bar);

    const ul = el('ul', 'files');
    for (const f of pr.files) ul.append(fileRow(f));
    files.append(ul);
  }

  function renderTimeline() {
    timeline.textContent = '';
    if (!state.timeline.length) return;
    const reviews = state.timeline.filter((e) => e.kind === 'review').length;
    const comments = state.timeline.length - reviews;
    timeline.append(el('div', 'count', [
      `conversation · ${comments} comment${comments === 1 ? '' : 's'}`,
      reviews ? `${reviews} review${reviews === 1 ? '' : 's'}` : '',
    ].filter(Boolean).join(' · ')));
    for (const entry of state.timeline) timeline.append(card(entry));
  }

  // ── actions ───────────────────────────────────────────────────────────
  function renderActs() {
    acts.textContent = '';
    const it = state.item, pr = state.pr;
    const b = (label, type, cls) => {
      const x = el('button', `btn ${cls || 'ghost'}`, label);
      x.addEventListener('click', () => {
        if (type === 'comment') {
          const body = draft.value;
          if (!body.trim()) { draft.focus(); return; }
          post('comment', { body });
          x.disabled = true;
        } else post(type);
      });
      return x;
    };
    acts.append(b('COMMENT', 'comment', ''));
    if (it.open) acts.append(b('CLOSE', 'close'));
    else acts.append(b('REOPEN', 'reopen'));
    acts.append(b('ASSIGN', 'assign'));
    acts.append(b('LABEL', 'label'));
    if (pr && it.open && !pr.merged) {
      acts.append(b('REVIEWERS', 'review'));
      acts.append(b('CHECK OUT', 'checkout'));
      acts.append(b('MERGE', 'merge'));
    }
    acts.append(el('span', 'hint', 'Ctrl+Enter posts a comment'));
  }

  function render() {
    if (!state) return;
    document.body.className = state.item.kind;
    renderHead();
    renderStrip();
    renderLinks();
    desc.textContent = '';
    const author = el('div', 'who');
    const av = avatar(state.item.author);
    if (av) author.append(av);
    author.append(el('span', null, (state.item.author && state.item.author.login) || ''));
    author.append(el('span', null, state.item.opened));
    desc.append(author);
    desc.append(prose(state.item.bodyHtml));
    renderFiles();
    renderTimeline();
    renderActs();
  }

  // ── wiring ────────────────────────────────────────────────────────────
  $('refresh').addEventListener('click', () => post('refresh'));
  $('browser').addEventListener('click', () => state && post('open', { url: state.item.url }));
  draft.addEventListener('keydown', (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter' && draft.value.trim()) post('comment', { body: draft.value });
  });

  window.addEventListener('message', (ev) => {
    const m = ev.data;
    if (!m) return;
    if (m.type === 'loading') { banner.textContent = state ? '' : 'Loading…'; return; }
    if (m.type === 'error') { banner.textContent = m.error || 'Something went wrong'; return; }
    if (m.type === 'commented') { draft.value = ''; return; }
    if (m.type === 'state') {
      banner.textContent = '';
      state = m.state;
      vs.setState(state);
      render();
    }
  });

  const saved = vs.getState();
  if (saved) { state = saved; render(); }
  post('ready');
})();
