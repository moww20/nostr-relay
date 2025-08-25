const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const CONFIG_FILE = 'env.json';
let mainWindow;
const running = new Map();
let termProc = null;

function getConfigPath() {
  const dir = app.getPath('userData');
  return path.join(dir, CONFIG_FILE);
}

function loadEnv() {
  try {
    const p = getConfigPath();
    if (fs.existsSync(p)) {
      const raw = fs.readFileSync(p, 'utf8');
      return JSON.parse(raw);
    }
  } catch {}
  return {};
}

function saveEnv(envObj) {
  try {
    const p = getConfigPath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(envObj || {}, null, 2), 'utf8');
    return true;
  } catch {
    return false;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

function emitToRenderer(channel, payload) {
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send(channel, payload);
  }
}

function runScript(runId, npmScript, extraArgs, envVars) {
  const mergedEnv = { ...process.env, ...(envVars || {}) };
  const args = ['run', npmScript];
  if (Array.isArray(extraArgs) && extraArgs.length) args.push('--', ...extraArgs);
  const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, {
    cwd: path.resolve(__dirname, '..'),
    env: mergedEnv,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  running.set(runId, child);

  const onData = (data, stream) => {
    const text = data.toString();
    emitToRenderer('cmd:log', { runId, stream, text });
  };

  child.stdout.on('data', (d) => onData(d, 'stdout'));
  child.stderr.on('data', (d) => onData(d, 'stderr'));

  child.on('exit', (code, signal) => {
    running.delete(runId);
    emitToRenderer('cmd:exit', { runId, code, signal });
  });

  emitToRenderer('cmd:start', { runId, pid: child.pid, npmScript, args: extraArgs || [] });
}

app.whenReady().then(() => {
  createWindow();

  ipcMain.handle('env:load', () => {
    return loadEnv();
  });

  ipcMain.handle('env:save', (_e, data) => {
    const ok = saveEnv(data || {});
    return { success: ok };
  });

  ipcMain.handle('cmd:run', (_e, payload) => {
    const runId = String(Date.now()) + ':' + Math.random().toString(36).slice(2, 8);
    const { script, args, env } = payload || {};
    runScript(runId, String(script || ''), Array.isArray(args) ? args : [], env || loadEnv());
    return { runId };
  });

  ipcMain.handle('cmd:stop', (_e, runId) => {
    const child = running.get(runId);
    if (child) {
      try { child.kill('SIGTERM'); } catch {}
      running.delete(runId);
      return { stopped: true };
    }
    return { stopped: false };
  });

  // Simple terminal (non-PTY) using system shell
  ipcMain.handle('term:start', () => {
    if (termProc) return { ok: true, already: true };
    const isWin = process.platform === 'win32';
    const shell = isWin ? (process.env.ComSpec || 'cmd.exe') : (process.env.SHELL || '/bin/bash');
    const args = isWin ? ['/Q'] : ['-l'];
    const child = spawn(shell, args, { cwd: path.resolve(__dirname, '..'), env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    termProc = child;
    const send = (type, data) => emitToRenderer('term:data', { type, data: data.toString() });
    child.stdout.on('data', (d) => send('stdout', d));
    child.stderr.on('data', (d) => send('stderr', d));
    child.on('exit', (code, signal) => {
      emitToRenderer('term:exit', { code, signal });
      termProc = null;
    });
    emitToRenderer('term:start', { shell, args });
    return { ok: true };
  });

  ipcMain.handle('term:input', (_e, text) => {
    if (!termProc) return { ok: false };
    try {
      termProc.stdin.write(String(text || ''));
      return { ok: true };
    } catch {
      return { ok: false };
    }
  });

  ipcMain.handle('term:stop', () => {
    if (!termProc) return { stopped: false };
    try { termProc.kill('SIGTERM'); } catch {}
    termProc = null;
    return { stopped: true };
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});