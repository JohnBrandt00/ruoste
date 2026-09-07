// @ts-check
'use strict';
/** What an issue and a pull request have to do with each other.
 *
 *  GitHub's own "Development" sidebar is a GraphQL-only field, so this is
 *  assembled from what REST does expose, in two passes:
 *
 *    · a pull request's body and title name the issues it closes, in GitHub's
 *      closing-keyword grammar — no request needed, and it is the link people
 *      actually mean;
 *    · the timeline of either one carries `cross-referenced` events, which is
 *      how the issue → pull request direction is visible at all. A link made
 *      only by dragging in the Development panel produces a `connected` event
 *      that REST returns without naming its target; those are counted, and
 *      reported as a count, rather than silently dropped. */

/** GitHub's closing keywords, exactly as documented. @type {string[]} */
const CLOSING = ['close', 'closes', 'closed', 'fix', 'fixes', 'fixed', 'resolve', 'resolves', 'resolved'];

const REF = new RegExp(
  `\\b(${CLOSING.join('|')})\\b\\s*:?\\s+` +               // keyword, optional colon
  `(?:https?://[^\\s/]+/([\\w.-]+)/([\\w.-]+)/(?:issues|pull)/(\\d+)` +  // a full url
  `|([\\w.-]+)/([\\w.-]+)#(\\d+)` +                        // owner/repo#12
  `|#(\\d+))`,                                             // #12
  'gi');

/** Issues a pull request's text says it closes.
 * @param {string} text body, or title and body joined
 * @param {{owner:string, repo:string}} self the repo the text lives in
 * @returns {{owner:string, repo:string, number:number}[]} */
function closingRefs(text, self) {
  /** @type {Map<string, {owner:string, repo:string, number:number}>} */ const out = new Map();
  for (const m of String(text || '').matchAll(REF)) {
    const owner = m[2] || m[5] || self.owner;
    const repo = m[3] || m[6] || self.repo;
    const number = Number(m[4] || m[7] || m[8]);
    if (!Number.isFinite(number) || !number) continue;
    // "closes #12" inside a fenced block or a quote is still a closing keyword
    // to GitHub, so it is one here too
    out.set(`${owner}/${repo}#${number}`.toLowerCase(), { owner, repo, number });
  }
  return [...out.values()];
}

/** @param {any} item @returns {'pr'|'issue'} */
const kindOf = (item) => (item && (item.pull_request || item.head) ? 'pr' : 'issue');

/** @param {any} issue @returns {{owner:string, repo:string}|null} */
function repoOfUrl(issue) {
  const m = /\/repos\/([^/]+)\/([^/?#]+)/.exec(String(issue?.repository_url || issue?.url || ''));
  return m ? { owner: m[1], repo: m[2] } : null;
}

/** Cross-references out of a timeline, newest kept once.
 * @param {any[]} events @param {{owner:string, repo:string, number:number}} self
 * @returns {{owner:string, repo:string, number:number, title:string, kind:'pr'|'issue',
 *            state:string, merged:boolean, url:string, relation:string}[]} */
function linksFromTimeline(events, self) {
  /** @type {Map<string, any>} */ const out = new Map();
  for (const e of Array.isArray(events) ? events : []) {
    if (e?.event !== 'cross-referenced') continue;
    const src = e.source?.issue;
    if (!src) continue;
    const repo = repoOfUrl(src) || { owner: self.owner, repo: self.repo };
    if (Number(src.number) === Number(self.number) &&
        repo.owner.toLowerCase() === self.owner.toLowerCase() &&
        repo.repo.toLowerCase() === self.repo.toLowerCase()) continue;   // itself
    const key = `${repo.owner}/${repo.repo}#${src.number}`.toLowerCase();
    out.set(key, {
      owner: repo.owner, repo: repo.repo, number: Number(src.number),
      title: String(src.title || ''), kind: kindOf(src),
      state: String(src.state || ''), merged: Boolean(src.pull_request?.merged_at),
      url: String(src.html_url || ''), relation: 'referenced',
    });
  }
  return [...out.values()];
}

/** @param {any[]} events @returns {number} links made in the Development panel,
 *  which REST reports without naming what they point at */
function unnamedConnections(events) {
  let n = 0;
  for (const e of Array.isArray(events) ? events : []) {
    if (e?.event === 'connected') n++;
    else if (e?.event === 'disconnected') n--;
  }
  return Math.max(0, n);
}

/** Merge the closing refs a pull request declares with the cross-references its
 *  timeline carries, so a closing link outranks a passing mention.
 * @param {{owner:string, repo:string, number:number}[]} closing
 * @param {any[]} referenced
 * @returns {any[]} */
function mergeLinks(closing, referenced) {
  /** @type {Map<string, any>} */ const out = new Map();
  for (const r of referenced) out.set(`${r.owner}/${r.repo}#${r.number}`.toLowerCase(), r);
  for (const c of closing) {
    const key = `${c.owner}/${c.repo}#${c.number}`.toLowerCase();
    const known = out.get(key);
    out.set(key, known
      ? { ...known, relation: 'closes' }
      : { ...c, title: '', kind: 'issue', state: '', merged: false, url: '', relation: 'closes' });
  }
  return [...out.values()].sort((a, b) =>
    (a.relation === 'closes' ? 0 : 1) - (b.relation === 'closes' ? 0 : 1) || a.number - b.number);
}

module.exports = { closingRefs, linksFromTimeline, unnamedConnections, mergeLinks, CLOSING };
