(function () {
  'use strict';
  const vs = acquireVsCodeApi();
  const post = (type, extra) => vs.postMessage(Object.assign({ type }, extra || {}));
  const $ = (id) => document.getElementById(id);
  const grid = $('grid'), detail = $('detail'), summary = $('summary'),
        budget = $('budget'), filter = $('filter'), banner = $('banner');

  let state = null, term = '', layout = 'grid', compact = false, selected = null;

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const cls = (s) => String(s || '').trim().replace(/\s+/g, '.');

  // ── layout ────────────────────────────────────────────────────────────
  function applyLayout() {
    document.body.className = `${layout}${compact ? ' compact' : ''}`;
    for (const b of document.querySelectorAll('.seg button[data-layout]'))
      b.classList.toggle('on', b.dataset.layout === layout);
    const d = document.querySelector('.seg button[data-density]');
    if (d) d.classList.toggle('on', compact);
  }

  function setLayout(next) {
    layout = next;
    applyLayout();
    post('layout', { layout, compact });
    render();
  }

  // ── run row, shared by every layout ───────────────────────────────────
  function runRow(repo, run) {
    const li = el('li');
    li.append(el('span', `dot ${cls(run.state)}`));
    li.append(el('span', 'wf', run.name));
    li.append(el('span', 'br', run.branch));
    li.append(el('span', 'tm', run.done ? run.took : run.when));
    const act = el('div', 'act');
    const b = (label, type) => {
      const x = el('button', null, label);
      x.addEventListener('click', (ev) => { ev.stopPropagation(); post(type, { key: repo.key, id: run.id }); });
      return x;
    };
    act.append(run.done ? b('RERUN', 'rerun') : b('CANCEL', 'cancel'));
    li.append(act);
    li.title = `#${run.number} · ${run.state}${run.actor ? ` · by ${run.actor}` : ''}${run.event ? ` · ${run.event}` : ''}`;
    li.addEventListener('click', () => post('open', { url: run.url }));
    return li;
  }

  function repoCard(r) {
    const card = el('article', 'repo');
    const latest = r.runs[0];
    if (latest && !latest.done) card.classList.add('live');
    else if (latest && latest.state === 'failed') card.classList.add('fail');
    if (layout === 'split' && selected === r.key) card.classList.add('sel');

    const h3 = el('h3');
    h3.append(el('span', `dot ${latest ? cls(latest.state) : ''}`));
    const name = el('span', 'name', r.name);
    name.addEventListener('click', (ev) => {
      if (layout === 'split') { ev.stopPropagation(); selected = r.key; render(); return; }
      post('open', { url: r.url });
    });
    h3.append(name, el('span', 'src', r.source));
    card.append(h3);

    if (r.error) card.append(el('div', 'err', r.error));
    else if (!r.runs.length) card.append(el('div', 'empty', 'no runs'));
    else {
      const ul = el('ul', 'runs');
      for (const run of r.runs) ul.append(runRow(r, run));
      card.append(ul);
    }
    if (layout === 'split') card.addEventListener('click', () => { selected = r.key; render(); });
    return card;
  }

  function renderDetail(repos) {
    detail.textContent = '';
    const r = repos.find((x) => x.key === selected) || repos[0];
    if (!r) { detail.append(el('div', 'gate', 'No repository selected.')); return; }
    selected = r.key;

    const dh = el('div', 'dh');
    dh.append(el('div', 't', `${r.owner}/${r.name}`));
    const latest = r.runs[0];
    dh.append(el('div', 's',
      `${r.source}${latest ? ` · latest ${latest.state} · ${latest.when}` : ' · no runs'}`));
    detail.append(dh);

    if (r.error) { detail.append(el('div', 'err', r.error)); return; }
    if (!r.runs.length) { detail.append(el('div', 'empty', 'no workflow runs')); return; }
    const ul = el('ul', 'runs');
    for (const run of r.runs) ul.append(runRow(r, run));
    detail.append(ul);
  }

  // ── main render ───────────────────────────────────────────────────────
  function render() {
    if (!state) return;

    // problems that would otherwise be invisible — a partial discovery looks
    // exactly like "you only have one repo" without this
    if (state.error) {
      banner.textContent = '';
      banner.className = 'on' + (/rate limit|failed/i.test(state.error) ? ' err' : '');
      banner.append(el('span', null, state.error));
      const x = el('span', 'x', '✕');
      x.addEventListener('click', () => { banner.className = ''; });
      banner.append(x);
    } else banner.className = '';

    if (!state.signedIn) {
      grid.textContent = '';
      grid.append(el('div', 'gate', 'Sign in to GitHub to see your pipelines.'));
      return;
    }

    summary.textContent =
      `${state.repoCount} repo${state.repoCount === 1 ? '' : 's'}` +
      (state.live ? ` · ${state.live} running` : '') +
      (state.failing ? ` · ${state.failing} failing` : '') +
      (state.hidden ? ` · ${state.hidden} hidden` : '') +
      (state.loading ? ' · refreshing…' : '');
    budget.textContent = '';
    budget.append(el('span', null, state.budget ? `rate limit ${state.budget}` : ''));
    if (state.scope) budget.append(el('span', null, `scope: ${state.scope}`));

    grid.textContent = '';
    /** @type {any[]} */ const visible = [];
    for (const group of state.owners) {
      const repos = group.repos.filter((r) =>
        !term || `${r.owner}/${r.name}`.toLowerCase().includes(term));
      if (!repos.length) continue;
      visible.push(...repos);

      const sec = el('section', 'owner');
      if (group.owner) {
        const h2 = el('h2');
        h2.append(el('span', null, group.owner), el('span', 'count', String(repos.length)));
        sec.append(h2);
      }
      const wrap = el('div', 'repos');
      for (const r of repos) wrap.append(repoCard(r));
      sec.append(wrap);
      grid.append(sec);
    }
    if (!visible.length)
      grid.append(el('div', 'gate', term ? `Nothing matches “${term}”.` : 'No repositories yet.'));

    if (layout === 'split') renderDetail(visible);
  }

  // ── wiring ────────────────────────────────────────────────────────────
  for (const b of document.querySelectorAll('.seg button[data-layout]'))
    b.addEventListener('click', () => setLayout(b.dataset.layout));
  const dens = document.querySelector('.seg button[data-density]');
  if (dens) dens.addEventListener('click', () => { compact = !compact; applyLayout(); post('layout', { layout, compact }); });

  filter.addEventListener('input', () => { term = filter.value.trim().toLowerCase(); render(); });
  $('refresh').addEventListener('click', () => post('refresh'));
  $('run').addEventListener('click', () => post('run'));
  $('scope').addEventListener('click', () => post('scope'));

  window.addEventListener('message', (ev) => {
    const m = ev.data;
    if (!m) return;
    if (m.type === 'state') { state = m.state; render(); }
    if (m.type === 'layout') {
      layout = m.layout || layout; compact = !!m.compact; applyLayout(); render();
    }
  });
  applyLayout();
  post('ready');
})();
