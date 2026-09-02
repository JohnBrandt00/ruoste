// @ts-check
'use strict';

/** Parse an owner/repo out of any git remote URL form GitHub accepts.
 * @param {string} url
 * @returns {{owner:string, repo:string, host:string}|null} */
function parseRemote(url) {
  if (!url || typeof url !== 'string') return null;
  let s = url.trim().replace(/\.git$/i, '').replace(/\/+$/, '');
  let host, path;

  let m = /^git@([^:]+):(.+)$/.exec(s);                 // git@github.com:o/r
  if (m) { host = m[1]; path = m[2]; }
  if (!host) {
    m = /^ssh:\/\/(?:[^@]+@)?([^/:]+)(?::\d+)?\/(.+)$/.exec(s);  // ssh://git@host/o/r
    if (m) { host = m[1]; path = m[2]; }
  }
  if (!host) {
    m = /^https?:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+)$/.exec(s); // https://host/o/r
    if (m) { host = m[1]; path = m[2]; }
  }
  if (!host) {
    m = /^git:\/\/([^/]+)\/(.+)$/.exec(s);
    if (m) { host = m[1]; path = m[2]; }
  }
  if (!host || !path) return null;

  const parts = path.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  // GHE can serve under /<org>/<repo>; take the LAST two segments
  const owner = parts[parts.length - 2];
  const repo = parts[parts.length - 1];
  if (!owner || !repo) return null;
  return { owner, repo, host };
}

/** @param {number} ms @returns {string} */
function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60), rs = s % 60;
  if (m < 60) return rs ? `${m}m ${rs}s` : `${m}m`;
  const h = Math.floor(m / 60), rm = m % 60;
  return rm ? `${h}h ${rm}m` : `${h}h`;
}

/** @param {string|Date|null|undefined} when @param {number} [now] @returns {string} */
function relativeTime(when, now = Date.now()) {
  if (!when) return '';
  const t = when instanceof Date ? when.getTime() : Date.parse(when);
  if (!Number.isFinite(t)) return '';
  const d = Math.max(0, now - t), s = Math.round(d / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const dd = Math.round(h / 24);
  if (dd < 7) return `${dd}d ago`;
  const w = Math.round(dd / 7);
  if (w < 5) return `${w}w ago`;
  return new Date(t).toISOString().slice(0, 10);
}

/** Map a run/job status+conclusion to a codicon and a theme colour id.
 * Colour ids are ones RUOSTE defines, so this tracks the active theme.
 * @param {string|null|undefined} status
 * @param {string|null|undefined} conclusion
 * @returns {{icon:string, color:string|undefined, label:string, live:boolean}} */
function statusPresentation(status, conclusion) {
  if (status === 'in_progress')
    return { icon: 'sync~spin', color: 'testing.iconQueued', label: 'running', live: true };
  if (status === 'queued' || status === 'pending' || status === 'waiting')
    return { icon: 'clock', color: 'testing.iconQueued', label: String(status), live: true };
  if (status === 'requested')
    return { icon: 'clock', color: 'testing.iconQueued', label: 'requested', live: true };

  switch (conclusion) {
    case 'success':         return { icon: 'pass-filled',     color: 'testing.iconPassed',  label: 'success',   live: false };
    case 'failure':         return { icon: 'error',           color: 'testing.iconFailed',  label: 'failed',    live: false };
    case 'timed_out':       return { icon: 'watch',           color: 'testing.iconErrored', label: 'timed out', live: false };
    case 'action_required': return { icon: 'warning',         color: 'testing.iconQueued',  label: 'action required', live: false };
    case 'cancelled':       return { icon: 'circle-slash',    color: 'disabledForeground',  label: 'cancelled', live: false };
    case 'skipped':         return { icon: 'debug-step-over', color: 'disabledForeground',  label: 'skipped',   live: false };
    case 'neutral':         return { icon: 'circle-outline',  color: 'disabledForeground',  label: 'neutral',   live: false };
    case 'stale':           return { icon: 'circle-slash',    color: 'disabledForeground',  label: 'stale',     live: false };
    default:                return { icon: 'circle-outline',  color: 'disabledForeground',  label: status || 'unknown', live: false };
  }
}

/** @param {{run_started_at?:string, created_at?:string, updated_at?:string, status?:string}} run
 *  @param {number} [now] @returns {number} elapsed ms */
function runElapsed(run, now = Date.now()) {
  const start = Date.parse(run.run_started_at || run.created_at || '');
  if (!Number.isFinite(start)) return NaN;
  const end = run.status === 'completed' ? Date.parse(run.updated_at || '') : now;
  return Number.isFinite(end) ? end - start : NaN;
}

/** Short branch label: drops refs/heads/, truncates the middle.
 * @param {string|null|undefined} ref @param {number} [max] @returns {string} */
function shortRef(ref, max = 28) {
  if (!ref) return '';
  let s = String(ref).replace(/^refs\/heads\//, '').replace(/^refs\/tags\//, 'tag:');
  if (s.length <= max) return s;
  const head = Math.ceil((max - 1) / 2), tail = Math.floor((max - 1) / 2);
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

module.exports = {
  parseRemote, formatDuration, relativeTime,
  statusPresentation, runElapsed, shortRef,
};
