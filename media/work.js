(function () {
  'use strict';
  const vs = acquireVsCodeApi();
  const post = (type, extra) => vs.postMessage(Object.assign({ type }, extra || {}));
  const $ = (id) => document.getElementById(id);
  const head = $('head'), strip = $('strip'), desc = $('desc'), files = $('files'),
        timeline = $('timeline'), acts = $('acts'), banner = $('banner'),
        where = $('where'), chip = $('chip'), draft = $('draft');

  let state = null;

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

  function renderFiles() {
    files.textContent = '';
    const pr = state.pr;
    if (!pr || !pr.files.length) return;
    const d = el('details', 'files');
    d.append(el('summary', null, `${pr.files.length} changed file${pr.files.length === 1 ? '' : 's'}`));
    const ul = el('ul');
    for (const f of pr.files) {
      const li = el('li');
      li.append(el('span', 'path', f.name));
      li.append(el('span', 'add', `+${f.additions}`));
      li.append(el('span', 'del', `−${f.deletions}`));
      li.append(el('span', 'st', f.status));
      li.addEventListener('click', () => post('open', { url: f.url }));
      ul.append(li);
    }
    d.append(ul);
    files.append(d);
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
