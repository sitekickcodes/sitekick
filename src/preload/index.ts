import { contextBridge } from 'electron'
import type { SitekickApi } from '../shared/api'

const api: SitekickApi = {
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node
  }
}

contextBridge.exposeInMainWorld('sitekick', api)
