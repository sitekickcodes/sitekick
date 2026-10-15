// The app core: Model, Msg, update, and the pure helpers they call -
// plain TypeScript in the app-core subset, compiled to native code at
// build time (no JS runtime ships in the binary). The view lives in
// app.native and binds this model by its field names.
//
// Imperative work (filesystem, git, dev servers, agents) belongs in
// src/services/, reached from update by returning a command.

export interface Model {
  readonly sidebarOpen: boolean;
}

export type Msg =
  | { readonly kind: "show_sidebar" }
  | { readonly kind: "hide_sidebar" };

export function initialModel(): Model {
  return { sidebarOpen: true };
}

export function update(model: Model, msg: Msg): Model {
  switch (msg.kind) {
    case "show_sidebar":
      return { ...model, sidebarOpen: true };
    case "hide_sidebar":
      return { ...model, sidebarOpen: false };
  }
}
