// @ts-check
'use strict';
const vscode = require('vscode');

const nope = () => { throw new Error('Not implemented'); };

/** Runs `fn` on an interval while `isVisible()`; a tick is skipped while one is in flight. */
class Poller {
  /** @param {() => Promise<void>} fn @param {() => boolean} isVisible @param {number} intervalMs
   *  @param {{setInterval:Function, clearInterval:Function}} [timers] */
  constructor(fn, isVisible, intervalMs, timers) { nope(); }
  /** @returns {Promise<void>} */
  async tick() { return nope(); }
  start() { nope(); }
  stop() { nope(); }
}

/** Tree of sessions; children of a session are its agents. */
class SessionsProvider {
  /** @param {() => import('./read').ViewModel} getModel
   *  @param {(sessionId:string) => import('./read').ReadResult<import('./read').AgentRow[]>} getAgents
   *  @param {() => number} [now] */
  constructor(getModel, getAgents, now) { nope(); }
  refresh() { nope(); }
  /** @param {any} el @returns {vscode.TreeItem} */
  getTreeItem(el) { return nope(); }
  /** @param {any} [el] @returns {any[]} */
  getChildren(el) { return nope(); }
}

/** Build the view model from disk. Sessions come first; the rest is for the selected one.
 *  @param {{home:string, isAlive:(pid:number)=>boolean, now:()=>number}} deps
 *  @returns {{refresh:(selected?:string)=>import('./read').ViewModel,
 *    getAgents:(sessionId:string)=>import('./read').ReadResult<import('./read').AgentRow[]>}} */
function createStore(deps) { return nope(); }

/** @param {vscode.ExtensionContext} ctx
 *  @param {{home?:string, isAlive?:(pid:number)=>boolean, now?:()=>number}} [deps]
 *  @returns {{provider:SessionsProvider, poller:Poller}|undefined} */
function activateSessions(ctx, deps) { return nope(); }

module.exports = { activateSessions, Poller, SessionsProvider, createStore };
