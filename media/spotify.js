// RUOSTE · Spotify webview. Talks to the extension host over postMessage only.
(function () {
  'use strict';
  const vs = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  const post = (type, extra) => vs.postMessage(Object.assign({ type }, extra || {}));

  const el = {
    app: $('app'), gate: $('gate'), player: $('player'), backdrop: $('backdrop'),
    art: $('art'), dj: $('dj'), title: $('title'), artist: $('artist'),
    scrub: $('scrub'), fill: $('fill'), knob: $('knob'), pos: $('pos'), dur: $('dur'),
    toggle: $('toggle'), prev: $('prev'), next: $('next'),
    shuffle: $('shuffle'), repeat: $('repeat'), like: $('like'),
    device: $('device'), devicename: $('devicename'), vol: $('vol'),
    queue: $('queue'), error: $('error'), search: $('search'), signin: $('signin'),
  };

  const time = (ms) => {
    if (!isFinite(ms) || ms < 0) ms = 0;
    const t = Math.floor(ms / 1000);
    return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  };

  let state = null;
  let dragging = false;      // suppress incoming progress while scrubbing
  let volTimer = null;

  // ── render ───────────────────────────────────────────────────────────
  function render(s) {
    state = s;
    el.app.classList.toggle('signed-out', !s.signedIn);
    el.gate.hidden = !!s.signedIn;
    el.player.hidden = !s.signedIn;

    if (s.error) { el.error.hidden = false; el.error.textContent = s.error; }
    else el.error.hidden = true;
    if (!s.signedIn) return;

    // artwork
    if (s.art) {
      if (el.art.getAttribute('src') !== s.art) {
        el.art.setAttribute('src', s.art);
        el.backdrop.style.backgroundImage = `url("${s.art}")`;
        el.backdrop.classList.add('on');
      }
      el.art.classList.add('on');
    } else {
      el.art.classList.remove('on');
      el.backdrop.classList.remove('on');
    }
    el.dj.classList.toggle('on', !!s.dj);

    // text
    if (el.title.textContent !== s.title) {
      el.title.textContent = s.title || 'Nothing playing';
      // only animate when it actually overflows
      requestAnimationFrame(() => {
        const over = el.title.scrollWidth > el.title.parentElement.clientWidth + 4;
        el.title.classList.toggle('scroll', over);
      });
    }
    el.artist.textContent = s.artist || (s.hasDevice ? s.deviceName : 'No active device');

    // scrubber
    if (!dragging) {
      const pct = s.duration > 0 ? Math.min(100, (s.progress / s.duration) * 100) : 0;
      el.fill.style.width = pct + '%';
      el.knob.style.left = pct + '%';
      el.pos.textContent = time(s.progress);
      el.dur.textContent = time(s.duration);
    }

    el.toggle.textContent = s.playing ? '❚❚' : '▶';
    el.toggle.title = s.playing ? 'Pause' : 'Play';
    el.shuffle.classList.toggle('active', !!s.shuffle);
    el.repeat.classList.toggle('active', s.repeat !== 'off');
    el.repeat.textContent = s.repeat === 'track' ? '↻¹' : '↻';
    el.like.classList.toggle('active', !!s.liked);
    el.like.textContent = s.liked ? '♥' : '♡';
    el.devicename.textContent = s.deviceName || 'DEVICE';
    el.device.classList.toggle('active', !!s.hasDevice);
    if (document.activeElement !== el.vol && typeof s.volume === 'number') el.vol.value = String(s.volume);

    renderQueue(s.queue || []);
  }

  function renderQueue(items) {
    if (el.queue.childElementCount === items.length && el.queue.dataset.first === (items[0] && items[0].uri)) return;
    el.queue.dataset.first = (items[0] && items[0].uri) || '';
    el.queue.textContent = '';
    items.slice(0, 25).forEach((t, i) => {
      const li = document.createElement('li');
      li.title = 'Play now';
      const n = document.createElement('span'); n.className = 'n'; n.textContent = String(i + 1);
      const nm = document.createElement('span'); nm.className = 't'; nm.textContent = t.name || '';
      const ar = document.createElement('span'); ar.className = 'a';
      ar.textContent = (t.artists || []).map((a) => a.name).join(', ');
      li.append(n, nm, ar);
      li.addEventListener('click', () => post('playQueued', { uri: t.uri }));
      el.queue.append(li);
    });
  }

  // ── scrubbing ────────────────────────────────────────────────────────
  function fractionFrom(ev) {
    const r = el.scrub.getBoundingClientRect();
    return Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
  }
  function preview(f) {
    el.fill.style.width = f * 100 + '%';
    el.knob.style.left = f * 100 + '%';
    if (state) el.pos.textContent = time(f * state.duration);
  }
  el.scrub.addEventListener('pointerdown', (ev) => {
    if (!state || !state.duration) return;
    dragging = true; el.scrub.classList.add('dragging');
    el.scrub.setPointerCapture(ev.pointerId);
    preview(fractionFrom(ev));
  });
  el.scrub.addEventListener('pointermove', (ev) => { if (dragging) preview(fractionFrom(ev)); });
  el.scrub.addEventListener('pointerup', (ev) => {
    if (!dragging) return;
    const f = fractionFrom(ev);
    dragging = false; el.scrub.classList.remove('dragging');
    post('seek', { value: Math.round(f * state.duration) });
  });
  el.scrub.addEventListener('keydown', (ev) => {
    if (!state || !state.duration) return;
    const step = ev.shiftKey ? 30000 : 5000;
    if (ev.key === 'ArrowRight') post('seek', { value: Math.min(state.duration, state.progress + step) });
    if (ev.key === 'ArrowLeft')  post('seek', { value: Math.max(0, state.progress - step) });
  });

  // ── controls ─────────────────────────────────────────────────────────
  el.toggle.addEventListener('click', () => post('toggle'));
  el.prev.addEventListener('click', () => post('previous'));
  el.next.addEventListener('click', () => post('next'));
  el.shuffle.addEventListener('click', () => post('shuffle'));
  el.repeat.addEventListener('click', () => post('repeat'));
  el.like.addEventListener('click', () => post('like'));
  el.device.addEventListener('click', () => post('device'));
  el.search.addEventListener('click', () => post('search'));
  el.dj.addEventListener('click', () => post('dj'));
  el.signin.addEventListener('click', () => post('signIn'));
  el.vol.addEventListener('input', () => {
    clearTimeout(volTimer);                     // debounce: one call per gesture
    const v = Number(el.vol.value);
    volTimer = setTimeout(() => post('volume', { value: v }), 220);
  });

  // keyboard: space toggles unless focus is in the volume slider
  document.addEventListener('keydown', (ev) => {
    if (ev.key === ' ' && document.activeElement !== el.vol) { ev.preventDefault(); post('toggle'); }
  });

  // ── local progress tick so the bar moves between polls ───────────────
  setInterval(() => {
    if (!state || !state.playing || dragging || !state.duration) return;
    state.progress = Math.min(state.duration, state.progress + 250);
    const pct = (state.progress / state.duration) * 100;
    el.fill.style.width = pct + '%';
    el.knob.style.left = pct + '%';
    el.pos.textContent = time(state.progress);
  }, 250);

  window.addEventListener('message', (ev) => {
    if (ev.data && ev.data.type === 'state') render(ev.data.state);
  });
  post('ready');
})();
