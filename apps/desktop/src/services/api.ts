// Decodes platform /api/v1 responses into typed records. The core can't use
// JSON, so it fetches with Cmd.fetch and hands the body bytes here.
import type { DeviceStart, ParseRequest, SessionInfo, SessionStatus, Site, SitesResult, TokensResult } from "../shared.ts";

const encoder = new TextEncoder();

function decodeObject(body: Uint8Array): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(body));
  } catch {
    throw { kind: "bad_json", message: "the platform sent a response that isn't JSON" };
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw { kind: "bad_shape", message: "the platform sent an unexpected response" };
  }
  return value as Record<string, unknown>;
}

function text(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== "string") throw { kind: "bad_shape", message: `missing ${field} in the platform response` };
  return value;
}

/** POST /auth/refresh and /auth/device/token success bodies. */
export function parseTokens(request: ParseRequest): TokensResult {
  const body = decodeObject(request.body);
  const user = body["user"];
  if (user === null || typeof user !== "object") throw { kind: "bad_shape", message: "missing user in the platform response" };
  const userRecord = user as Record<string, unknown>;
  return {
    session: encoder.encode(`${text(body, "refreshToken")}\n${text(body, "accessToken")}`),
    userName: encoder.encode(text(userRecord, "name")),
    userEmail: encoder.encode(text(userRecord, "email")),
    isStaff: userRecord["kind"] === "staff",
  };
}

/** POST /auth/device success body. */
export function parseDeviceStart(request: ParseRequest): DeviceStart {
  const body = decodeObject(request.body);
  const interval = body["interval"];
  return {
    deviceCode: encoder.encode(text(body, "deviceCode")),
    userCode: encoder.encode(text(body, "userCode")),
    verificationUri: encoder.encode(text(body, "verificationUriComplete")),
    intervalMs: typeof interval === "number" && interval >= 1 && interval <= 60 ? Math.round(interval) * 1000 : 3000,
  };
}

/** GET /me/sites success body. */
export function parseSites(request: ParseRequest): SitesResult {
  const body = decodeObject(request.body);
  const raw = body["sites"];
  if (!Array.isArray(raw)) throw { kind: "bad_shape", message: "missing sites in the platform response" };
  const sites: Site[] = [];
  for (const entry of raw) {
    if (entry === null || typeof entry !== "object") continue;
    const site = entry as Record<string, unknown>;
    const org = site["organization"];
    const orgName = org !== null && typeof org === "object" ? (org as Record<string, unknown>)["name"] : null;
    const id = site["id"];
    if (typeof id !== "number") continue;
    sites.push({
      id,
      name: encoder.encode(typeof site["name"] === "string" ? site["name"] : "Untitled site"),
      slug: encoder.encode(typeof site["slug"] === "string" ? site["slug"] : ""),
      orgName: encoder.encode(typeof orgName === "string" ? orgName : ""),
      productionUrl: encoder.encode(typeof site["productionUrl"] === "string" ? site["productionUrl"] : ""),
      role: encoder.encode(typeof site["role"] === "string" ? site["role"] : ""),
      sessionsPath: encoder.encode(`/api/v1/sites/${id}/sessions`),
    });
  }
  return { sites };
}

const STATUSES: readonly SessionStatus[] = ["starting", "branching", "booting", "installing", "migrating", "starting_server", "ready", "failed", "stopped"];

/** POST /sites/:id/sessions, GET /sessions/:id, heartbeat and stop bodies. */
export function parseSession(request: ParseRequest): SessionInfo {
  const body = decodeObject(request.body);
  const id = body["id"];
  const status = body["status"];
  if (typeof id !== "number") throw { kind: "bad_shape", message: "missing id in the session response" };
  const known = STATUSES.find((s) => s === status);
  if (known === undefined) throw { kind: "bad_shape", message: "unknown session status" };
  const previewUrl = body["previewUrl"];
  const error = body["error"];
  return {
    status: known,
    previewUrl: encoder.encode(typeof previewUrl === "string" ? previewUrl : ""),
    problem: encoder.encode(typeof error === "string" ? error : ""),
    statusPath: encoder.encode(`/api/v1/sessions/${id}`),
    heartbeatPath: encoder.encode(`/api/v1/sessions/${id}/heartbeat`),
    stopPath: encoder.encode(`/api/v1/sessions/${id}/stop`),
  };
}
