const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const CONFIG_FILE = 'env.json';
let mainWindow;
const running = new Map();

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

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});