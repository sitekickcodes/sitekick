// Opens a URL in the system browser.
//
// Workaround: Native SDK 0.11's TypeScript-core runner drops the manifest's
// security.navigation.external_links, so Cmd.openExternalUrl is always denied
// ("external URL denied by security.navigation.external_links"). Services
// can run processes, so this asks the OS to open the URL instead. Remove it
// once the SDK passes external_links through.
import { spawnSync } from "node:child_process";

import type { OpenBrowserRequest, OpenBrowserResult } from "../shared.ts";

export function openBrowser(request: OpenBrowserRequest): OpenBrowserResult {
  const url = new TextDecoder().decode(request.url);
  if (!/^https?:\/\/[^\s"'`<>]+$/.test(url)) {
    throw { kind: "bad_url", message: "only plain http(s) URLs can be opened" };
  }
  const opener =
    process.platform === "darwin"
      ? { cmd: "open", args: [url] }
      : process.platform === "win32"
        ? { cmd: "cmd", args: ["/c", "start", "", url] }
        : { cmd: "xdg-open", args: [url] };
  const result = spawnSync(opener.cmd, opener.args, { stdio: "ignore" });
  if (result.status !== 0) {
    throw { kind: "open_failed", message: `${opener.cmd} exited with ${String(result.status)}` };
  }
  return { opened: true };
}
