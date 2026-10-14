/** The API the preload script exposes to the renderer as `window.sitekick`. */
export interface SitekickApi {
  versions: {
    electron: string
    chrome: string
    node: string
  }
}
