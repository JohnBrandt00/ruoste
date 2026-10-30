// Chief View script. Host posts {type:'model', model}; this posts 'ready',
// {type:'select', sessionId} and {type:'openReport', sessionId, path}.
// Text goes in with textContent only, never innerHTML.
(function () {
  // @ts-ignore acquireVsCodeApi is provided by the webview host
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);

  const ICON = { working: '▶', needsPermission: '⚠', needsInput: '?', waiting: '●', ended: '○', unknown: '–' };
  const LABEL = { working: 'Working', needsPermission: 'Needs permission', needsInput: 'Needs input', waiting: 'Waiting', ended: 'Ended', unknown: 'Unknown' };

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  const clear = (box) => { while (box.firstChild) box.removeChild(box.firstChild); };
  const empty = (box, text) => box.appendChild(el('div', 'empty', text));
  const tok = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n));
  /** Show the reason when a read failed. Returns true when the data is there. */
  function okOrNote(r, box) {
    if (r && r.ok) return true;
    empty(box, r && r.detail ? r.detail : 'No data.');
    return false;
  }
  function reportButton(model, file) {
    const b = el('button', 'report', file);
    b.type = 'button';
    b.addEventListener('click', () => vscode.postMessage({ type: 'openReport', sessionId: model.selected, path: file }));
    return b;
  }

  function renderBudget(model) {
    const box = $('budget'); clear(box);
    const r = model.budget;
    if (!r || !r.ok) { box.appendChild(el('span', '', 'Budget: not available')); return; }
    const b = r.value;
    const win = (label, w) => {
      if (!w) return;
      const s = el('span', 'win' + (w.pct >= 90 ? ' hot' : ''));
      s.appendChild(document.createTextNode(label + ' '));
      s.appendChild(el('b', '', Math.round(w.pct) + '%'));
      if (Number.isFinite(w.resetsAt)) {
        const ms = w.resetsAt < 1e12 ? w.resetsAt * 1000 : w.resetsAt;
        s.appendChild(document.createTextNode(' resets ' + new Date(ms).toLocaleString()));
      }
      box.appendChild(s);
    };
    win('5h', b.fiveHour); win('7d', b.sevenDay);
    if (b.stale) box.appendChild(el('span', '', '(old data)'));
  }

  function renderBanner(model) {
    const box = $('banner'); clear(box);
    if (model.error) box.appendChild(el('div', 'err', model.error));
    if (model.budget && model.budget.ok && model.budget.value.stale) box.appendChild(el('div', '', 'Budget data is old.'));
  }

  function renderSessions(model) {
    const box = $('sessionList'); clear(box);
    if (!model.sessions.length) { empty(box, 'No Claude sessions are open.'); return; }
    for (const s of model.sessions) {
      const sel = s.sessionId === model.selected;
      const b = el('button', 'item' + (sel ? ' sel' : ''));
      b.type = 'button';
      b.appendChild(el('span', 'icon st-' + s.status, ICON[s.status] || ICON.unknown));
      b.appendChild(el('span', 'name', s.name || s.sessionId));
      b.appendChild(el('span', 'tag st-' + s.status, LABEL[s.status] || LABEL.unknown));
      const sub = [s.cwd, s.branch].filter(Boolean).join('  ');
      if (sub) b.appendChild(el('span', 'sub', sub));
      if (sel) b.setAttribute('aria-current', 'true');
      b.addEventListener('click', () => vscode.postMessage({ type: 'select', sessionId: s.sessionId }));
      box.appendChild(b);
    }
  }

  function renderTimeline(model) {
    const box = $('timelineList'); clear(box);
    if (!okOrNote(model.ledger, box)) return;
    const led = model.ledger.value;
    if (led.skipped) box.appendChild(el('div', 'empty', led.skipped + ' ledger lines could not be read.'));
    if (!led.entries.length) { empty(box, 'The ledger has no entries.'); return; }
    for (const e of led.entries) {
      const row = el('div', 'item');
      row.appendChild(el('span', 'icon tag', '•'));
      row.appendChild(el('span', 'name', e.step + (e.agent ? ' · ' + e.agent : '')));
      row.appendChild(el('span', 'tag', [e.time, e.status].filter(Boolean).join(' ')));
      const sub = e.ruling ? e.ruling.decision + ' (' + e.ruling.why + ')' : e.result;
      if (sub) row.appendChild(el('span', 'sub', sub));
      if (e.report && model.selected) row.appendChild(reportButton(model, e.report));
      box.appendChild(row);
    }
  }

  function renderRoster(model) {
    const box = $('rosterList'); clear(box);
    if (!okOrNote(model.agents, box)) return;
    const agents = model.agents.value;
    if (!agents.length) { empty(box, 'No agents have run in this session.'); return; }
    for (const a of agents) {
      const row = el('div', 'item');
      row.appendChild(el('span', 'icon st-' + a.state, a.state === 'running' ? '▶' : '✓'));
      row.appendChild(el('span', 'name', a.agentType + (a.description ? ' · ' + a.description : '')));
      row.appendChild(el('span', 'tag', tok(a.tokens) + ' tok'));
      const sub = [a.model, a.effort, a.status].filter(Boolean).join('  ');
      if (sub) row.appendChild(el('span', 'sub', sub));
      if (a.report && model.selected) row.appendChild(reportButton(model, a.report));
      box.appendChild(row);
    }
  }

  window.addEventListener('message', (ev) => {
    const m = ev.data;
    if (!m || m.type !== 'model' || !m.model) return;
    renderBudget(m.model); renderBanner(m.model); renderSessions(m.model);
    renderTimeline(m.model); renderRoster(m.model);
  });
  vscode.postMessage({ type: 'ready' });
})();
