const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  loadEnv: () => ipcRenderer.invoke('env:load'),
  saveEnv: (data) => ipcRenderer.invoke('env:save', data),
  run: (script, args, env) => ipcRenderer.invoke('cmd:run', { script, args, env }),
  stop: (runId) => ipcRenderer.invoke('cmd:stop', runId),
  onLog: (cb) => ipcRenderer.on('cmd:log', (_e, m) => cb(m)),
  onStart: (cb) => ipcRenderer.on('cmd:start', (_e, m) => cb(m)),
  onExit: (cb) => ipcRenderer.on('cmd:exit', (_e, m) => cb(m)),
  termStart: () => ipcRenderer.invoke('term:start'),
  termInput: (text) => ipcRenderer.invoke('term:input', text),
  termStop: () => ipcRenderer.invoke('term:stop'),
  onTermStart: (cb) => ipcRenderer.on('term:start', (_e, m) => cb(m)),
  onTermData: (cb) => ipcRenderer.on('term:data', (_e, m) => cb(m)),
  onTermExit: (cb) => ipcRenderer.on('term:exit', (_e, m) => cb(m))
});