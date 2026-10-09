import { contextBridge, ipcRenderer } from 'electron'
import type { Command, EngineEvent, ToyboxApi } from '../shared/protocol'
import type { HostApi } from '../renderer/hostApi'

const api: ToyboxApi & HostApi = {
  on(handler) {
    const listener = (_e: unknown, event: EngineEvent) => handler(event)
    ipcRenderer.on('engine:event', listener)
    return () => {
      ipcRenderer.removeListener('engine:event', listener)
    }
  },
  send(command: Command) {
    ipcRenderer.send('engine:command', command)
  },
  readFile: (rel) => ipcRenderer.invoke('host:readFile', rel),
  tailFile: (rel, fromByte) => ipcRenderer.invoke('host:tailFile', rel, fromByte),
  openFolder: (rel) => ipcRenderer.invoke('host:openFolder', rel)
}

contextBridge.exposeInMainWorld('toybox', api)
