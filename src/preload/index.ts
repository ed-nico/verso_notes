import { contextBridge, ipcRenderer } from 'electron'
import type { FileEvent, VersoApi } from '../shared/types.js'

const api: VersoApi = {
  platform: process.platform,
  openWorkspace: () => ipcRenderer.invoke('workspace:open'),
  loadWorkspace: (root) => ipcRenderer.invoke('workspace:load', root),
  readNote: (path) => ipcRenderer.invoke('note:read', path),
  readAll: () => ipcRenderer.invoke('note:readAll'),
  writeNote: (path, text) => ipcRenderer.invoke('note:write', path, text),
  createNote: (path, text) => ipcRenderer.invoke('note:create', path, text),
  renameNote: (oldPath, newPath) => ipcRenderer.invoke('note:rename', oldPath, newPath),
  deleteNote: (path) => ipcRenderer.invoke('note:delete', path),
  revealNote: (path) => ipcRenderer.invoke('note:reveal', path),
  saveAsset: (filename, dataBase64) => ipcRenderer.invoke('asset:save', filename, dataBase64),
  listAssets: () => ipcRenderer.invoke('asset:list'),
  deleteAsset: (path) => ipcRenderer.invoke('asset:delete', path),
  listCanvases: () => ipcRenderer.invoke('canvas:list'),
  readCanvas: (path) => ipcRenderer.invoke('canvas:read', path),
  writeCanvas: (path, data) => ipcRenderer.invoke('canvas:write', path, data),
  createCanvas: (path) => ipcRenderer.invoke('canvas:create', path),
  renameCanvas: (oldPath, newPath) => ipcRenderer.invoke('canvas:rename', oldPath, newPath),
  deleteCanvas: (path) => ipcRenderer.invoke('canvas:delete', path),
  readBases: () => ipcRenderer.invoke('bases:read'),
  writeBases: (data) => ipcRenderer.invoke('bases:write', data),
  readCustomCss: () => ipcRenderer.invoke('css:read'),
  getLastWorkspace: () => ipcRenderer.invoke('workspace:last'),
  getWorkspaces: () => ipcRenderer.invoke('workspace:recents'),
  forgetWorkspace: (root) => ipcRenderer.invoke('workspace:forget', root),
  fetchTitle: (url) => ipcRenderer.invoke('link:title', url),
  checkSpelling: (words) => ipcRenderer.invoke('spell:check', words),
  suggestSpelling: (word) => ipcRenderer.invoke('spell:suggest', word),
  addToDictionary: (word) => ipcRenderer.invoke('spell:add', word),
  onFileEvent: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, event: FileEvent): void => cb(event)
    ipcRenderer.on('file-event', listener)
    return () => ipcRenderer.removeListener('file-event', listener)
  }
}

contextBridge.exposeInMainWorld('verso', api)
