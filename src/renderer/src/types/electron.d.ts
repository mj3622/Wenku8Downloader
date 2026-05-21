export interface ElectronAPI {
  platform: NodeJS.Platform
  getApiPort: () => Promise<number>
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
