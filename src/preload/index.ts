import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  getApiPort: () => ipcRenderer.invoke('get-api-port'),
})
