// @ts-check
'use strict';
const vscode = require('vscode');

/** Validate a message from the webview. Returns what the host must do.
 *  @param {any} msg @param {import('./read').ViewModel} model
 *  @returns {{action:'select', sessionId:string}|{action:'open', file:string}|{action:'ignore'}} */
function handleWebviewMessage(msg, model) { throw new Error('Not implemented'); }

/** @param {vscode.ExtensionContext} ctx @param {(selected?:string)=>import('./read').ViewModel} getModel
 *  @param {string} [sessionId] */
function openChiefView(ctx, getModel, sessionId) { throw new Error('Not implemented'); }

/** Push the current model to the open panel, if any. */
function refreshChiefView() { throw new Error('Not implemented'); }

module.exports = { handleWebviewMessage, openChiefView, refreshChiefView };
