// @ts-nocheck
'use strict';
/** Redirect `require('vscode')` to the stub, so modules that import the
 *  extension API can be loaded in a plain node process. Require this FIRST. */
const Module = require('node:module');
const path = require('node:path');
const STUB = path.join(__dirname, 'vscode-stub.js');
const original = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === 'vscode') return STUB;
  return original.call(this, request, ...rest);
};
module.exports = { STUB };
