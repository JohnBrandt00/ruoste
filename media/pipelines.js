(function () {
  'use strict';
  const vs = acquireVsCodeApi();
  const post = (type, extra) => vs.postMessage(Object.assign({ type }, extra || {}));
  const $ = (id) => document.getElementById(id);
  const grid = $('grid'), summary = $('summary'), budget = $('budget'), filter = $('filter');
  let state = null, term = '';

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };

  function render() {
    if (!state) return;
    if (!state.signedIn) {
      grid.textContent = '';
      grid.append(el('div', 'gate', 'Sign in to GitHub to see your pipelines.'));
      return;
    }
    summary.textContent =
      `${state.repoCount} repos` +
      (state.live ? ` · ${state.live} running` : '') +
      (state.failing ? ` · ${state.failing} failing` : '');
    budget.textContent = state.budget ? `rate limit ${state.budget}` : '';

    grid.textContent = '';
    let shown = 0;
    for (const group of state.owners) {
      const repos = group.repos.filter((r) =>
        !term || `${r.owner}/${r.name}`.toLowerCase().includes(term));
      if (!repos.length) continue;
      shown += repos.length;

      const sec = el('section', 'owner');
      const h2 = el('h2');
      h2.append(el('span', null, group.owner), el('span', 'count', String(repos.length)));
      sec.append(h2);

      const wrap = el('div', 'repos');
      for (const r of repos) {
        const card = el('article', 'repo');
        const latest = r.runs[0];
        if (latest && !latest.done) card.classList.add('live');
        else if (latest && latest.state === 'failed') card.classList.add('fail');

        const h3 = el('h3');
        h3.append(el('span', `dot ${latest ? latest.state.replace(/\s+/g, '.') : ''}`));
        const name = el('span', 'name', r.name);
        name.addEventListener('click', () => post('open', { url: r.url }));
        h3.append(name, el('span', 'src', r.source));
        card.append(h3);

        if (r.error) card.append(el('div', 'err', r.error));
        else if (!r.runs.length) card.append(el('div', 'empty', 'no runs'));
        else {
          const ul = el('ul', 'runs');
          for (const run of r.runs) {
            const li = el('li');
            li.append(el('span', `dot ${run.state.replace(/\s+/g, '.')}`));
            li.append(el('span', 'wf', run.name));
            li.append(el('span', 'br', run.branch));
            li.append(el('span', 'tm', run.done ? run.took : run.when));
            const act = el('div', 'act');
            const b = (label, type) => {
              const x = el('button', null, label);
              x.addEventListener('click', (ev) => { ev.stopPropagation(); post(type, { key: r.key, id: run.id }); });
              return x;
            };
            act.append(run.done ? b('RERUN', 'rerun') : b('CANCEL', 'cancel'));
            li.append(act);
            li.title = `#${run.number} · ${run.state}${run.actor ? ` · by ${run.actor}` : ''}${run.event ? ` · ${run.event}` : ''}`;
            li.addEventListener('click', () => post('open', { url: run.url }));
            ul.append(li);
          }
          card.append(ul);
        }
        wrap.append(card);
      }
      sec.append(wrap);
      grid.append(sec);
    }
    if (!shown) grid.append(el('div', 'gate', term ? `Nothing matches “${term}”.` : 'No repositories yet.'));
  }

  filter.addEventListener('input', () => { term = filter.value.trim().toLowerCase(); render(); });
  $('refresh').addEventListener('click', () => post('refresh'));
  $('run').addEventListener('click', () => post('run'));
  window.addEventListener('message', (ev) => {
    if (ev.data && ev.data.type === 'state') { state = ev.data.state; render(); }
  });
  post('ready');
})();
