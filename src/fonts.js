// @ts-check
'use strict';
const vscode = require('vscode');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const FAMILY = 'Geist Mono';
const STACK = "'Geist Mono', 'GeistMono Nerd Font', 'JetBrains Mono', 'IBM Plex Mono', 'SFMono-Regular', Menlo, Consolas, monospace";

/** @param {string} cmd @param {string[]} args @returns {Promise<{code:number, stdout:string, stderr:string}>} */
function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true }, (err, stdout, stderr) =>
      resolve({ code: err ? 1 : 0, stdout: String(stdout || ''), stderr: String(stderr || '') }));
  });
}

/** Where this platform keeps per-user fonts. @returns {string|null} */
function userFontDir() {
  const home = os.homedir();
  switch (process.platform) {
    case 'darwin': return path.join(home, 'Library', 'Fonts');
    case 'win32':  return path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'),
                                    'Microsoft', 'Windows', 'Fonts');
    default:       return path.join(home, '.local', 'share', 'fonts');
  }
}

/** "GeistMono-SemiBoldItalic.ttf" -> "Geist Mono SemiBold Italic (TrueType)" (Windows registry name)
 * @param {string} file @returns {string} */
function registryName(file) {
  const stem = path.basename(file, path.extname(file));           // GeistMono-SemiBoldItalic
  const style = (stem.split('-')[1] || 'Regular')
    .replace(/([a-z])([A-Z])/g, '$1 $2');                          // SemiBold Italic
  return `${FAMILY} ${style} (TrueType)`;
}

/** @param {vscode.ExtensionContext} ctx @returns {string} */
function bundledFontDir(ctx) {
  return path.join(ctx.extensionPath, 'fonts');
}

/** Copy the bundled TTFs into the user font directory and register them.
 * @param {vscode.ExtensionContext} ctx
 * @returns {Promise<{installed:string[], dir:string, notes:string[]}>} */
async function installFonts(ctx) {
  const src = bundledFontDir(ctx);
  const dest = userFontDir();
  const notes = [];
  if (!dest) throw new Error(`Unsupported platform: ${process.platform}`);

  const files = (await fsp.readdir(src)).filter((f) => f.toLowerCase().endsWith('.ttf'));
  if (!files.length) throw new Error(`No .ttf files found in ${src}`);

  await fsp.mkdir(dest, { recursive: true });
  const installed = [];
  for (const f of files) {
    await fsp.copyFile(path.join(src, f), path.join(dest, f));
    installed.push(f);
  }

  if (process.platform === 'linux') {
    const r = await run('fc-cache', ['-f']);
    notes.push(r.code === 0 ? 'Refreshed the font cache (fc-cache).'
                            : 'Could not run fc-cache; log out and back in if the font does not appear.');
  }
  if (process.platform === 'win32') {
    let failed = 0;
    for (const f of installed) {
      const r = await run('reg', ['add',
        'HKCU\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Fonts',
        '/v', registryName(f), '/t', 'REG_SZ', '/d', path.join(dest, f), '/f']);
      if (r.code !== 0) failed++;
    }
    notes.push(failed
      ? `${failed} font(s) copied but not registered — install them by hand from ${dest}.`
      : 'Registered the fonts for your user account.');
  }
  return { installed, dir: dest, notes };
}

/** If a user-level editor.fontFamily is shadowing the extension default, offer to fix it.
 * This is the usual reason the font "doesn't work". @returns {Promise<void>} */
async function reconcileFontSetting() {
  const cfg = vscode.workspace.getConfiguration();
  const info = cfg.inspect('editor.fontFamily');
  const override = info && (info.globalValue ?? info.workspaceValue);
  if (typeof override !== 'string') return;                 // nothing shadowing us
  if (/geist\s*mono/i.test(override)) return;               // already asking for it

  const pick = await vscode.window.showInformationMessage(
    `Your settings set editor.fontFamily to ${override.split(',')[0].trim()}, which overrides RUOSTE. Use Geist Mono instead?`,
    'Use Geist Mono', 'Keep mine');
  if (pick === 'Use Geist Mono') {
    const target = info && info.workspaceValue !== undefined
      ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global;
    await cfg.update('editor.fontFamily', STACK, target);
  }
}

/** @param {vscode.ExtensionContext} ctx @returns {Promise<void>} */
async function installFontCommand(ctx) {
  try {
    const res = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'RUOSTE: installing Geist Mono…' },
      () => installFonts(ctx));
    await reconcileFontSetting();
    const pick = await vscode.window.showInformationMessage(
      `Installed ${res.installed.length} Geist Mono fonts to ${res.dir}. ${res.notes.join(' ')} Reload to pick them up.`,
      'Reload Window', 'Open Folder', 'Later');
    if (pick === 'Reload Window') await vscode.commands.executeCommand('workbench.action.reloadWindow');
    else if (pick === 'Open Folder') await vscode.env.openExternal(vscode.Uri.file(res.dir));
  } catch (err) {
    const dir = bundledFontDir(ctx);
    const pick = await vscode.window.showErrorMessage(
      `RUOSTE could not install the fonts automatically: ${err && err.message ? err.message : err}. ` +
      `You can install them by hand from the extension's fonts folder.`,
      'Open Fonts Folder');
    if (pick === 'Open Fonts Folder') await vscode.env.openExternal(vscode.Uri.file(dir));
  }
}

/** One-time nudge, the first time the extension ever activates.
 * @param {vscode.ExtensionContext} ctx @returns {Promise<void>} */
async function maybeOfferInstall(ctx) {
  const KEY = 'ruoste.fontPromptShown';
  if (ctx.globalState.get(KEY)) return;
  await ctx.globalState.update(KEY, true);
  const pick = await vscode.window.showInformationMessage(
    'RUOSTE draws for Geist Mono. VS Code cannot install a font by itself — install the bundled copy now?',
    'Install Geist Mono', 'Not now');
  if (pick === 'Install Geist Mono') await installFontCommand(ctx);
}

module.exports = {
  FAMILY, STACK, userFontDir, registryName, bundledFontDir,
  installFonts, installFontCommand, maybeOfferInstall, reconcileFontSetting,
};
