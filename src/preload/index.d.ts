import type { SitekickApi } from '../shared/api'

declare global {
  interface Window {
    /** Undefined when the renderer runs in a plain browser (e.g. the preview pane). */
    sitekick?: SitekickApi
  }
}
