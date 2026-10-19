// The app core: Model, Msg, update and the pure helpers they call, in the
// checked TypeScript subset compiled to native code. The view is app.native.
//
// Sign-in is a browser device flow (no password ever touches the app):
//   sign_in -> POST /auth/device -> show the code, open /activate, poll
//   /auth/device/token on a timer -> tokens -> keychain -> load sites.
// Tokens live only in the keychain as one credential, `session`
// (`<refresh>\n<access>`). Every authenticated call reads it, builds its
// header and fetches; nothing secret is kept in the Model.
//
// Opening a site starts (or resumes) an editing session on the platform: a
// sandbox running the site's dev server. The core polls its status while it
// sets up, then points the preview WebView (webPanes) at its URL, sends a
// heartbeat while it's open, and stops it on switch/sign-out.
//
// API responses are JSON, which the core can't parse: the `api` service
// (src/services/api.ts) decodes them into the records in shared.ts.

import { Cmd, Sub, asciiBytes, utf8Bytes, type EnvMsg } from "@native-sdk/core";
import type { WebViewPane } from "@native-sdk/core/events";
import { applyTextInputEvent, clampedInsertEvent, containsIgnoreCase, type TextEditState, type TextInputEvent } from "@native-sdk/core/text";
import { apiParseDeviceStart, apiParseSession, apiParseSites, apiParseTokens } from "@native-sdk/services";

import { afterNewline, beforeNewline, joined, sameBytes } from "./bytes.ts";
import type { DeviceStart, SessionInfo, Site, SitesResult, TokensResult } from "./shared.ts";

export type Screen = "starting" | "signedOut" | "awaitingApproval" | "loadingSites" | "pickingSite" | "workspace";

/// What to resume after a token refresh triggered by a 401.
export type AfterRefresh = "loadSites" | "startSession" | "pollSession" | "heartbeat" | "stopSession";

/// The open site's session, as the platform reports it ("none" before one exists).
export type SessionState =
  | "none"
  | "starting"
  | "branching"
  | "booting"
  | "installing"
  | "migrating"
  | "starting_server"
  | "ready"
  | "failed"
  | "stopped";

/// What to do once the current session has been stopped.
export type AfterStop = "nothing" | "pickSite" | "signOut";

export interface Model {
  readonly screen: Screen;
  /// Platform origin, e.g. https://sitekick-platform.vercel.app. SITEKICK_API_URL overrides it.
  readonly apiBase: Uint8Array;
  /// One line shown on the sign-in and picker screens (errors, "signed out").
  readonly notice: Uint8Array;
  /// The notice is a failure worth retrying (offline, platform error).
  readonly canRetry: boolean;
  readonly userCode: Uint8Array;
  readonly verificationUri: Uint8Array;
  readonly pollMs: number;
  readonly userName: Uint8Array;
  readonly userEmail: Uint8Array;
  readonly isStaff: boolean;
  readonly sites: readonly Site[];
  readonly currentSiteId: number;
  /// The last site opened, remembered across launches (Cmd.store).
  readonly lastSiteSlug: Uint8Array;
  readonly query: Uint8Array;
  readonly queryAnchor: number;
  readonly queryFocus: number;
  readonly queryCompStart: number;
  readonly queryCompEnd: number;
  // ---- editing session for the open site
  readonly sessionStatus: SessionState;
  readonly previewUrl: Uint8Array;
  readonly sessionError: Uint8Array;
  readonly sessionStatusPath: Uint8Array;
  readonly sessionHeartbeatPath: Uint8Array;
  readonly sessionStopPath: Uint8Array;
  readonly reloadToken: number;
  readonly afterRefresh: AfterRefresh;
  readonly afterStop: AfterStop;
}

export type Msg =
  // boot
  | { readonly kind: "api_base_set"; readonly value: Uint8Array }
  | { readonly kind: "last_site_loaded"; readonly slug: Uint8Array }
  | { readonly kind: "last_site_missing"; readonly reason: Uint8Array }
  | { readonly kind: "session_missing"; readonly reason: Uint8Array }
  | { readonly kind: "retry" }
  // refresh: session -> POST /auth/refresh -> tokens
  | { readonly kind: "session_for_refresh"; readonly session: Uint8Array }
  | { readonly kind: "refreshed"; readonly status: number; readonly body: Uint8Array }
  // browser sign-in
  | { readonly kind: "sign_in" }
  | { readonly kind: "device_started"; readonly status: number; readonly body: Uint8Array }
  | { readonly kind: "device_parsed"; readonly result: DeviceStart }
  | { readonly kind: "device_code_saved" }
  | { readonly kind: "open_browser" }
  | { readonly kind: "poll_tick"; readonly at: number }
  | { readonly kind: "device_code_loaded"; readonly code: Uint8Array }
  | { readonly kind: "polled"; readonly status: number; readonly body: Uint8Array }
  | { readonly kind: "cancel_sign_in" }
  // tokens -> keychain
  | { readonly kind: "tokens_parsed"; readonly result: TokensResult }
  | { readonly kind: "session_saved" }
  | { readonly kind: "device_code_cleared" }
  | { readonly kind: "device_code_clear_failed"; readonly reason: Uint8Array }
  // sites
  | { readonly kind: "load_sites" }
  | { readonly kind: "session_for_sites"; readonly session: Uint8Array }
  | { readonly kind: "sites_fetched"; readonly status: number; readonly body: Uint8Array }
  | { readonly kind: "sites_parsed"; readonly result: SitesResult }
  | { readonly kind: "query_edited"; readonly edit: TextInputEvent }
  | { readonly kind: "open_site"; readonly id: number }
  | { readonly kind: "switch_site" }
  // editing session
  | { readonly kind: "start_session" }
  | { readonly kind: "session_for_start"; readonly session: Uint8Array }
  | { readonly kind: "session_started"; readonly status: number; readonly body: Uint8Array }
  | { readonly kind: "session_parsed"; readonly result: SessionInfo }
  | { readonly kind: "status_tick"; readonly at: number }
  | { readonly kind: "session_for_status"; readonly session: Uint8Array }
  | { readonly kind: "status_fetched"; readonly status: number; readonly body: Uint8Array }
  | { readonly kind: "heartbeat_tick"; readonly at: number }
  | { readonly kind: "session_for_heartbeat"; readonly session: Uint8Array }
  | { readonly kind: "heartbeat_sent"; readonly status: number; readonly body: Uint8Array }
  | { readonly kind: "reload_preview" }
  | { readonly kind: "session_for_stop"; readonly session: Uint8Array }
  | { readonly kind: "session_stopped"; readonly status: number; readonly body: Uint8Array }
  | { readonly kind: "stop_failed"; readonly reason: Uint8Array }
  // sign-out
  | { readonly kind: "sign_out" }
  | { readonly kind: "session_for_logout"; readonly session: Uint8Array }
  | { readonly kind: "logged_out"; readonly status: number; readonly body: Uint8Array }
  | { readonly kind: "logout_failed"; readonly reason: Uint8Array }
  | { readonly kind: "session_deleted" }
  // shared failure arms
  | { readonly kind: "request_failed"; readonly reason: Uint8Array }
  | { readonly kind: "parse_failed"; readonly error: Uint8Array }
  | { readonly kind: "keychain_failed"; readonly reason: Uint8Array }
  | { readonly kind: "saved" }
  | { readonly kind: "ignored"; readonly reason: Uint8Array };

const DEFAULT_API_BASE = asciiBytes("https://sitekick-platform.vercel.app");
const DEVICE_NAME_BODY = asciiBytes('{"deviceName":"Sitekick Desktop"}');
const SESSION = "session";
const DEVICE_CODE = "device-code";
const LAST_SITE = "last-site";
const MAX_QUERY_BYTES = 200;
const EMPTY = new Uint8Array(0);
const JSON_HEADERS = { "content-type": "application/json" };
const STATUS_POLL_MS = 2000;
const HEARTBEAT_MS = 5 * 60 * 1000;
const MAX_RELOAD_TOKEN = 1000000000;

export function initialModel(): [Model, Cmd<Msg>] {
  return [
    {
      screen: "starting",
      apiBase: DEFAULT_API_BASE,
      notice: EMPTY,
      canRetry: false,
      userCode: EMPTY,
      verificationUri: EMPTY,
      pollMs: 3000,
      userName: EMPTY,
      userEmail: EMPTY,
      isStaff: false,
      sites: [],
      currentSiteId: -1,
      lastSiteSlug: EMPTY,
      query: EMPTY,
      queryAnchor: 0,
      queryFocus: 0,
      queryCompStart: -1,
      queryCompEnd: -1,
      sessionStatus: "none",
      previewUrl: EMPTY,
      sessionError: EMPTY,
      sessionStatusPath: EMPTY,
      sessionHeartbeatPath: EMPTY,
      sessionStopPath: EMPTY,
      reloadToken: 0,
      afterRefresh: "loadSites",
      afterStop: "nothing",
    },
    Cmd.store.get(LAST_SITE, { ok: "last_site_loaded", err: "last_site_missing" }),
  ];
}

function url(model: Model, path: Uint8Array): Uint8Array {
  return joined([model.apiBase, path]);
}

function bearer(session: Uint8Array): Uint8Array {
  return joined([asciiBytes("Bearer "), afterNewline(session)]);
}

function withoutSession(model: Model): Model {
  return {
    ...model,
    sessionStatus: "none",
    previewUrl: EMPTY,
    sessionError: EMPTY,
    sessionStatusPath: EMPTY,
    sessionHeartbeatPath: EMPTY,
    sessionStopPath: EMPTY,
    afterStop: "nothing",
  };
}

function signedOut(model: Model, notice: Uint8Array): Model {
  return {
    ...withoutSession(model),
    screen: "signedOut",
    notice,
    canRetry: false,
    userCode: EMPTY,
    verificationUri: EMPTY,
    userName: EMPTY,
    userEmail: EMPTY,
    isStaff: false,
    sites: [],
    currentSiteId: -1,
    query: EMPTY,
    queryAnchor: 0,
    queryFocus: 0,
    queryCompStart: -1,
    queryCompEnd: -1,
    afterRefresh: "loadSites",
  };
}

function withSiteOpen(model: Model, site: Site): Model {
  return { ...withoutSession(model), screen: "workspace", currentSiteId: site.id, lastSiteSlug: site.slug, notice: EMPTY, sessionStatus: "starting" };
}

function hasLiveSession(model: Model): boolean {
  return model.sessionStopPath.length > 0 && model.sessionStatus !== "failed" && model.sessionStatus !== "stopped" && model.sessionStatus !== "none";
}

function currentSite(model: Model): Site | undefined {
  return model.sites.find((s) => s.id === model.currentSiteId);
}

export function update(model: Model, msg: Msg): [Model, Cmd<Msg>] {
  switch (msg.kind) {
    // ------------------------------------------------------------- boot
    case "api_base_set":
      if (msg.value.length === 0 || msg.value.length > 512) return [model, Cmd.none];
      return [{ ...model, apiBase: msg.value }, Cmd.none];
    case "last_site_loaded":
      return [{ ...model, lastSiteSlug: msg.slug }, Cmd.credentials.get(SESSION, { ok: "session_for_refresh", err: "session_missing" })];
    case "last_site_missing":
      return [model, Cmd.credentials.get(SESSION, { ok: "session_for_refresh", err: "session_missing" })];
    case "session_missing":
      return [signedOut(model, model.notice), Cmd.none];
    case "retry":
      return [{ ...model, screen: "starting", notice: EMPTY, afterRefresh: "loadSites" }, Cmd.credentials.get(SESSION, { ok: "session_for_refresh", err: "session_missing" })];

    // ---------------------------------------------------------- refresh
    case "session_for_refresh":
      return [
        model,
        Cmd.fetch(
          {
            url: url(model, asciiBytes("/api/v1/auth/refresh")),
            method: "POST",
            headers: JSON_HEADERS,
            body: joined([asciiBytes('{"refreshToken":"'), beforeNewline(msg.session), asciiBytes('"}')]),
            timeoutMs: 15000,
          },
          { key: "refresh", ok: "refreshed", err: "request_failed" },
        ),
      ];
    case "refreshed":
      if (msg.status === 200) return [model, apiParseTokens({ body: msg.body }, { key: "parse-tokens", ok: "tokens_parsed", err: "parse_failed" })];
      if (msg.status !== 400 && msg.status !== 401) {
        // A platform hiccup, not a bad session: keep it, offer a retry.
        return [{ ...model, screen: "signedOut", notice: utf8Bytes("Sitekick had a problem. Try again in a moment."), canRetry: true }, Cmd.none];
      }
      // The device was signed out or revoked: forget it.
      return [
        signedOut(model, utf8Bytes("Your session ended. Sign in again.")),
        Cmd.credentials.delete(SESSION, { ok: "session_deleted", err: "keychain_failed" }),
      ];

    // -------------------------------------------------- browser sign-in
    case "sign_in":
      return [
        { ...model, notice: EMPTY, afterRefresh: "loadSites" },
        Cmd.fetch(
          { url: url(model, asciiBytes("/api/v1/auth/device")), method: "POST", headers: JSON_HEADERS, body: DEVICE_NAME_BODY, timeoutMs: 15000 },
          { key: "device-start", ok: "device_started", err: "request_failed" },
        ),
      ];
    case "device_started":
      if (msg.status !== 200) return [{ ...model, notice: utf8Bytes("Couldn’t start sign-in. Try again in a moment.") }, Cmd.none];
      return [model, apiParseDeviceStart({ body: msg.body }, { key: "parse-device", ok: "device_parsed", err: "parse_failed" })];
    case "device_parsed":
      return [
        { ...model, screen: "awaitingApproval", userCode: msg.result.userCode, verificationUri: msg.result.verificationUri, pollMs: msg.result.intervalMs },
        Cmd.credentials.set(DEVICE_CODE, msg.result.deviceCode, { ok: "device_code_saved", err: "keychain_failed" }),
      ];
    case "device_code_saved":
    case "open_browser":
      return [model, Cmd.openExternalUrl(model.verificationUri)];
    case "poll_tick":
      if (model.screen !== "awaitingApproval") return [model, Cmd.none];
      return [model, Cmd.credentials.get(DEVICE_CODE, { ok: "device_code_loaded", err: "keychain_failed" })];
    case "device_code_loaded":
      if (model.screen !== "awaitingApproval") return [model, Cmd.none];
      return [
        model,
        Cmd.fetch(
          {
            url: url(model, asciiBytes("/api/v1/auth/device/token")),
            method: "POST",
            headers: JSON_HEADERS,
            body: joined([asciiBytes('{"deviceCode":"'), msg.code, asciiBytes('"}')]),
            timeoutMs: 15000,
          },
          // A poll still in flight when the next tick fires is rejected on
          // this key, which `ignored` swallows.
          { key: "device-poll", ok: "polled", err: "ignored" },
        ),
      ];
    case "polled":
      if (model.screen !== "awaitingApproval") return [model, Cmd.none];
      if (msg.status === 200) {
        return [{ ...model, screen: "loadingSites" }, apiParseTokens({ body: msg.body }, { key: "parse-tokens", ok: "tokens_parsed", err: "parse_failed" })];
      }
      if (containsIgnoreCase(msg.body, asciiBytes('"access_denied"'))) return [signedOut(model, utf8Bytes("Sign-in was denied in the browser.")), Cmd.none];
      if (containsIgnoreCase(msg.body, asciiBytes('"expired_token"'))) return [signedOut(model, utf8Bytes("That code expired. Start again.")), Cmd.none];
      return [model, Cmd.none]; // authorization_pending or slow_down: keep waiting
    case "cancel_sign_in":
      return [signedOut(model, EMPTY), Cmd.credentials.delete(DEVICE_CODE, { ok: "saved", err: "ignored" })];

    // ------------------------------------------------ tokens -> keychain
    case "tokens_parsed":
      return [
        {
          ...model,
          screen: model.screen === "workspace" ? "workspace" : "loadingSites",
          userName: msg.result.userName,
          userEmail: msg.result.userEmail,
          isStaff: msg.result.isStaff,
        },
        Cmd.credentials.set(SESSION, msg.result.session, { ok: "session_saved", err: "keychain_failed" }),
      ];
    case "session_saved":
      // The single-use device code (if this was a browser sign-in) is spent.
      return [model, Cmd.credentials.delete(DEVICE_CODE, { ok: "device_code_cleared", err: "device_code_clear_failed" })];
    case "device_code_cleared":
    case "device_code_clear_failed":
      // Resume whatever the refresh interrupted.
      switch (model.afterRefresh) {
        case "startSession":
          return [{ ...model, afterRefresh: "loadSites" }, Cmd.credentials.get(SESSION, { ok: "session_for_start", err: "session_missing" })];
        case "pollSession":
          return [{ ...model, afterRefresh: "loadSites" }, Cmd.credentials.get(SESSION, { ok: "session_for_status", err: "session_missing" })];
        case "heartbeat":
          return [{ ...model, afterRefresh: "loadSites" }, Cmd.credentials.get(SESSION, { ok: "session_for_heartbeat", err: "session_missing" })];
        case "stopSession":
          return [{ ...model, afterRefresh: "loadSites" }, Cmd.credentials.get(SESSION, { ok: "session_for_stop", err: "session_missing" })];
        case "loadSites":
          return [{ ...model, screen: "loadingSites" }, Cmd.credentials.get(SESSION, { ok: "session_for_sites", err: "session_missing" })];
      }
    case "load_sites":
      return [{ ...model, screen: "loadingSites" }, Cmd.credentials.get(SESSION, { ok: "session_for_sites", err: "session_missing" })];

    // ------------------------------------------------------------ sites
    case "session_for_sites":
      return [
        model,
        Cmd.fetch(
          { url: url(model, asciiBytes("/api/v1/me/sites")), headers: { authorization: bearer(msg.session) }, timeoutMs: 15000 },
          { key: "sites", ok: "sites_fetched", err: "request_failed" },
        ),
      ];
    case "sites_fetched":
      // An expired access token: refresh, which loads the sites again.
      if (msg.status === 401) return [{ ...model, afterRefresh: "loadSites" }, Cmd.credentials.get(SESSION, { ok: "session_for_refresh", err: "session_missing" })];
      if (msg.status !== 200) return [signedOut(model, utf8Bytes("Couldn’t load your sites. Try again in a moment.")), Cmd.none];
      return [model, apiParseSites({ body: msg.body }, { key: "parse-sites", ok: "sites_parsed", err: "parse_failed" })];
    case "sites_parsed": {
      const sites = msg.result.sites;
      const loaded = { ...model, sites, notice: EMPTY };
      // Exactly one site: straight in. Otherwise the picker, with the
      // last-opened site highlighted.
      const only = sites.length === 1 ? sites[0] : undefined;
      if (only !== undefined) {
        return [withSiteOpen(loaded, only), Cmd.store.set(LAST_SITE, only.slug, { ok: "start_session", err: "ignored" })];
      }
      return [{ ...loaded, screen: "pickingSite" }, Cmd.none];
    }
    case "query_edited": {
      const state: TextEditState = {
        text: model.query,
        selection: { anchor: model.queryAnchor, focus: model.queryFocus },
        composition: model.queryCompStart >= 0 ? { start: model.queryCompStart, end: model.queryCompEnd } : null,
      };
      let next = applyTextInputEvent(state, msg.edit, MAX_QUERY_BYTES);
      if (next === null) {
        const clamped = clampedInsertEvent(state, msg.edit, MAX_QUERY_BYTES);
        if (clamped === null) return [model, Cmd.none];
        next = applyTextInputEvent(state, clamped, MAX_QUERY_BYTES);
        if (next === null) return [model, Cmd.none];
      }
      const start = next.composition !== null ? next.composition.start : -1;
      const end = next.composition !== null ? next.composition.end : -1;
      return [
        {
          ...model,
          query: next.text,
          queryAnchor: next.selection.anchor,
          queryFocus: next.selection.focus,
          queryCompStart: start >= -1 && start <= 9007199254740991 ? Math.trunc(start) : -1,
          queryCompEnd: end >= -1 && end <= 9007199254740991 ? Math.trunc(end) : -1,
        },
        Cmd.none,
      ];
    }
    case "open_site": {
      const site = model.sites.find((s) => s.id === msg.id);
      if (site === undefined) return [model, Cmd.none];
      return [withSiteOpen(model, site), Cmd.store.set(LAST_SITE, site.slug, { ok: "start_session", err: "ignored" })];
    }
    case "switch_site":
      if (hasLiveSession(model)) {
        return [{ ...model, afterStop: "pickSite" }, Cmd.credentials.get(SESSION, { ok: "session_for_stop", err: "session_missing" })];
      }
      return [{ ...withoutSession(model), screen: "pickingSite", currentSiteId: -1 }, Cmd.none];

    // -------------------------------------------------- editing session
    case "start_session":
      if (model.screen !== "workspace") return [model, Cmd.none];
      return [
        { ...withoutSession(model), sessionStatus: "starting" },
        Cmd.credentials.get(SESSION, { ok: "session_for_start", err: "session_missing" }),
      ];
    case "session_for_start": {
      const site = currentSite(model);
      if (site === undefined || model.screen !== "workspace") return [model, Cmd.none];
      return [
        model,
        Cmd.fetch(
          { url: url(model, site.sessionsPath), method: "POST", headers: { authorization: bearer(msg.session) }, timeoutMs: 30000 },
          { key: "session-start", ok: "session_started", err: "request_failed" },
        ),
      ];
    }
    case "session_started":
      if (msg.status === 401) return [{ ...model, afterRefresh: "startSession" }, Cmd.credentials.get(SESSION, { ok: "session_for_refresh", err: "session_missing" })];
      if (msg.status === 403) {
        return [{ ...model, sessionStatus: "failed", sessionError: utf8Bytes("You can view this site but not edit it. Ask an owner for editor access.") }, Cmd.none];
      }
      if (msg.status !== 200 && msg.status !== 201) {
        return [{ ...model, sessionStatus: "failed", sessionError: utf8Bytes("Sitekick couldn’t start a session. Try again in a moment.") }, Cmd.none];
      }
      return [model, apiParseSession({ body: msg.body }, { key: "parse-session", ok: "session_parsed", err: "parse_failed" })];
    case "session_parsed":
      if (model.screen !== "workspace") return [model, Cmd.none];
      return [
        {
          ...model,
          sessionStatus: msg.result.status,
          previewUrl: msg.result.previewUrl,
          sessionError: msg.result.problem,
          sessionStatusPath: msg.result.statusPath,
          sessionHeartbeatPath: msg.result.heartbeatPath,
          sessionStopPath: msg.result.stopPath,
        },
        Cmd.none,
      ];
    case "status_tick":
      if (model.screen !== "workspace" || model.sessionStatusPath.length === 0) return [model, Cmd.none];
      return [model, Cmd.credentials.get(SESSION, { ok: "session_for_status", err: "session_missing" })];
    case "session_for_status":
      if (model.sessionStatusPath.length === 0) return [model, Cmd.none];
      return [
        model,
        Cmd.fetch(
          { url: url(model, model.sessionStatusPath), headers: { authorization: bearer(msg.session) }, timeoutMs: 15000 },
          // Overlapping polls are rejected on this key and ignored.
          { key: "session-status", ok: "status_fetched", err: "ignored" },
        ),
      ];
    case "status_fetched":
      if (msg.status === 401) return [{ ...model, afterRefresh: "pollSession" }, Cmd.credentials.get(SESSION, { ok: "session_for_refresh", err: "session_missing" })];
      if (msg.status !== 200) return [model, Cmd.none];
      return [model, apiParseSession({ body: msg.body }, { key: "parse-session", ok: "session_parsed", err: "parse_failed" })];
    case "heartbeat_tick":
      if (model.sessionStatus !== "ready") return [model, Cmd.none];
      return [model, Cmd.credentials.get(SESSION, { ok: "session_for_heartbeat", err: "session_missing" })];
    case "session_for_heartbeat":
      if (model.sessionHeartbeatPath.length === 0) return [model, Cmd.none];
      return [
        model,
        Cmd.fetch(
          { url: url(model, model.sessionHeartbeatPath), method: "POST", headers: { authorization: bearer(msg.session) }, timeoutMs: 30000 },
          { key: "session-heartbeat", ok: "heartbeat_sent", err: "ignored" },
        ),
      ];
    case "heartbeat_sent":
      if (msg.status === 401) return [{ ...model, afterRefresh: "heartbeat" }, Cmd.credentials.get(SESSION, { ok: "session_for_refresh", err: "session_missing" })];
      if (msg.status !== 200) return [model, Cmd.none];
      // The platform may report the session stopped (idle reaper): show it.
      return [model, apiParseSession({ body: msg.body }, { key: "parse-session", ok: "session_parsed", err: "parse_failed" })];
    case "reload_preview":
      return [{ ...model, reloadToken: model.reloadToken < MAX_RELOAD_TOKEN ? model.reloadToken + 1 : 0 }, Cmd.none];
    case "session_for_stop":
      if (model.sessionStopPath.length === 0) return [model, Cmd.none];
      return [
        model,
        Cmd.fetch(
          { url: url(model, model.sessionStopPath), method: "POST", headers: { authorization: bearer(msg.session) }, timeoutMs: 60000 },
          { key: "session-stop", ok: "session_stopped", err: "stop_failed" },
        ),
      ];
    case "session_stopped":
    case "stop_failed":
      if (msg.kind === "session_stopped" && msg.status === 401) {
        return [{ ...model, afterRefresh: "stopSession" }, Cmd.credentials.get(SESSION, { ok: "session_for_refresh", err: "session_missing" })];
      }
      // Stopped, already gone, or offline (the platform's reaper stops it
      // later): carry on either way.
      switch (model.afterStop) {
        case "pickSite":
          return [{ ...withoutSession(model), screen: "pickingSite", currentSiteId: -1 }, Cmd.none];
        case "signOut":
          return [signedOut(withoutSession(model), utf8Bytes("Signed out.")), Cmd.credentials.get(SESSION, { ok: "session_for_logout", err: "session_missing" })];
        case "nothing":
          return [withoutSession(model), Cmd.none];
      }

    // --------------------------------------------------------- sign-out
    case "sign_out":
      if (hasLiveSession(model)) {
        return [{ ...model, afterStop: "signOut" }, Cmd.credentials.get(SESSION, { ok: "session_for_stop", err: "session_missing" })];
      }
      return [signedOut(model, utf8Bytes("Signed out.")), Cmd.credentials.get(SESSION, { ok: "session_for_logout", err: "session_missing" })];
    case "session_for_logout":
      return [
        model,
        Cmd.fetch(
          {
            url: url(model, asciiBytes("/api/v1/auth/logout")),
            method: "POST",
            headers: JSON_HEADERS,
            body: joined([asciiBytes('{"refreshToken":"'), beforeNewline(msg.session), asciiBytes('"}')]),
            timeoutMs: 15000,
          },
          // Offline or not, the keychain entry goes.
          { key: "logout", ok: "logged_out", err: "logout_failed" },
        ),
      ];
    case "logged_out":
      // 204 or not (an already-revoked session answers 204 too), the
      // keychain entry goes. Reading status keeps it integer-typed like the
      // other fetch results.
      return [
        { ...model, notice: msg.status === 204 ? model.notice : utf8Bytes("Signed out on this device.") },
        Cmd.credentials.delete(SESSION, { ok: "session_deleted", err: "keychain_failed" }),
      ];
    case "logout_failed":
      // Offline: still forget the session here.
      return [model, Cmd.credentials.delete(SESSION, { ok: "session_deleted", err: "keychain_failed" })];
    case "session_deleted":
      return [signedOut(model, model.notice), Cmd.none];

    // ---------------------------------------------------------- failures
    case "request_failed":
      if (model.screen === "workspace") {
        return [{ ...model, sessionStatus: "failed", sessionError: utf8Bytes("Can’t reach Sitekick. Check your connection and try again.") }, Cmd.none];
      }
      return [
        {
          ...model,
          screen: model.screen === "starting" || model.screen === "loadingSites" ? "signedOut" : model.screen,
          notice: utf8Bytes("Can’t reach Sitekick. Check your connection and try again."),
          canRetry: true,
        },
        Cmd.none,
      ];
    case "parse_failed":
      if (model.screen === "workspace") {
        return [{ ...model, sessionStatus: "failed", sessionError: utf8Bytes("Sitekick sent a response the app didn’t understand.") }, Cmd.none];
      }
      return [signedOut(model, utf8Bytes("Sitekick sent a response the app didn’t understand.")), Cmd.none];
    case "keychain_failed":
      return [signedOut(model, utf8Bytes("Couldn’t use the keychain. Try signing in again.")), Cmd.none];
    case "saved":
    case "ignored":
      return [model, Cmd.none];
  }
}

// ---------------------------------------------------------- subscriptions

function provisioning(model: Model): boolean {
  return (
    model.sessionStatus === "starting" ||
    model.sessionStatus === "branching" ||
    model.sessionStatus === "booting" ||
    model.sessionStatus === "installing" ||
    model.sessionStatus === "migrating" ||
    model.sessionStatus === "starting_server"
  );
}

/// Poll for sign-in approval while waiting; poll session status while it
/// sets up; heartbeat while it's ready.
export function subscriptions(model: Model): Sub<Msg> {
  if (model.screen === "awaitingApproval") return Sub.timer("device-poll-timer", model.pollMs, "poll_tick");
  if (model.screen !== "workspace") return Sub.none;
  if (provisioning(model) && model.sessionStatusPath.length > 0) return Sub.timer("session-status-timer", STATUS_POLL_MS, "status_tick");
  if (model.sessionStatus === "ready") return Sub.timer("session-heartbeat-timer", HEARTBEAT_MS, "heartbeat_tick");
  return Sub.none;
}

// ------------------------------------------------------------ web pane

/// The preview WebView: pinned to the `preview-pane` panel and showing the
/// sandbox's dev server once it's ready, otherwise collapsed and blank.
export function webPanes(model: Model): readonly WebViewPane[] {
  if (model.screen === "workspace" && model.sessionStatus === "ready" && model.previewUrl.length > 0) {
    return [{ label: asciiBytes("preview"), anchor: asciiBytes("preview-pane"), x: 0, y: 0, width: 0, height: 0, url: model.previewUrl, reloadToken: model.reloadToken }];
  }
  // Parked as a 1-point frame on the platform's home page (the manifest
  // rejects about:blank and zero-size webviews).
  return [{ label: asciiBytes("preview"), anchor: null, x: 0, y: 0, width: 1, height: 1, url: model.apiBase, reloadToken: model.reloadToken }];
}

// ------------------------------------------------------- derived bindings

export function starting(model: Model): boolean {
  return model.screen === "starting";
}
export function isSignedOut(model: Model): boolean {
  return model.screen === "signedOut";
}
export function awaitingApproval(model: Model): boolean {
  return model.screen === "awaitingApproval";
}
export function loadingSites(model: Model): boolean {
  return model.screen === "loadingSites";
}
export function pickingSite(model: Model): boolean {
  return model.screen === "pickingSite";
}
export function inWorkspace(model: Model): boolean {
  return model.screen === "workspace";
}
export function hasNotice(model: Model): boolean {
  return model.notice.length > 0;
}
export function showRetry(model: Model): boolean {
  return model.canRetry;
}
export function hasSites(model: Model): boolean {
  return model.sites.length > 0;
}
export function canSwitchSite(model: Model): boolean {
  return model.sites.length > 1;
}
export function showSearch(model: Model): boolean {
  return model.sites.length > 6;
}

export function visibleSites(model: Model): readonly Site[] {
  if (model.query.length === 0) return model.sites;
  return model.sites.filter((s) => containsIgnoreCase(s.name, model.query) || containsIgnoreCase(s.orgName, model.query));
}

export function noMatches(model: Model): boolean {
  return model.sites.length > 0 && visibleSites(model).length === 0;
}

export function lastSiteId(model: Model): number {
  const last = model.sites.find((s) => sameBytes(s.slug, model.lastSiteSlug));
  return last === undefined ? -1 : last.id;
}

export function siteName(model: Model): Uint8Array {
  const site = currentSite(model);
  return site === undefined ? EMPTY : site.name;
}
export function siteOrg(model: Model): Uint8Array {
  const site = currentSite(model);
  return site === undefined ? EMPTY : site.orgName;
}
export function siteUrl(model: Model): Uint8Array {
  const site = currentSite(model);
  return site === undefined ? EMPTY : site.productionUrl;
}
export function siteRole(model: Model): Uint8Array {
  const site = currentSite(model);
  return site === undefined ? EMPTY : site.role;
}

export function pickerTitle(model: Model): Uint8Array {
  if (model.sites.length === 0) return utf8Bytes("No sites yet");
  return utf8Bytes("Choose a site");
}

export function emptyHelp(model: Model): Uint8Array {
  return model.isStaff
    ? utf8Bytes("Add a site in the Sitekick admin, then reload.")
    : utf8Bytes("You don’t have access to any sites yet. Ask your Sitekick contact to invite you.");
}

export function previewReady(model: Model): boolean {
  return model.sessionStatus === "ready";
}
export function sessionSettingUp(model: Model): boolean {
  return provisioning(model);
}
export function sessionFailed(model: Model): boolean {
  return model.sessionStatus === "failed" || model.sessionStatus === "stopped";
}

export function sessionPhase(model: Model): Uint8Array {
  switch (model.sessionStatus) {
    case "starting":
      return utf8Bytes("Starting your workspace…");
    case "branching":
      return utf8Bytes("Copying the site’s database…");
    case "booting":
      return utf8Bytes("Starting a sandbox and cloning the site…");
    case "installing":
      return utf8Bytes("Installing dependencies… (a few minutes the first time)");
    case "migrating":
      return utf8Bytes("Updating the database schema…");
    case "starting_server":
      return utf8Bytes("Starting the dev server…");
    case "ready":
      return utf8Bytes("Live preview");
    case "failed":
      return utf8Bytes("The workspace couldn’t start.");
    case "stopped":
      return utf8Bytes("This workspace was stopped after a while without activity.");
    case "none":
      return EMPTY;
  }
}

export function sessionProblem(model: Model): Uint8Array {
  return model.sessionError;
}

// ---------------------------------------------------- host-event channels

/// Launch configuration: SITEKICK_API_URL points the app at another
/// platform (local dev: http://localhost:3100).
export const envMsgs: readonly EnvMsg<Msg>[] = [{ env: "SITEKICK_API_URL", msg: "api_base_set" }];

/// Host-fired Msg arms and fields the markup reads through helpers.
export const viewUnbound = [
  "api_base_set", "last_site_loaded", "last_site_missing", "session_missing", "session_for_refresh", "refreshed",
  "device_started", "device_parsed", "device_code_saved", "poll_tick", "device_code_loaded", "polled",
  "tokens_parsed", "session_saved", "device_code_cleared", "device_code_clear_failed", "session_for_sites", "sites_fetched",
  "sites_parsed", "session_for_start", "session_started", "session_parsed", "status_tick", "session_for_status",
  "status_fetched", "heartbeat_tick", "session_for_heartbeat", "heartbeat_sent", "session_for_stop", "session_stopped",
  "stop_failed", "session_for_logout", "logged_out", "logout_failed", "session_deleted", "saved", "request_failed",
  "parse_failed", "keychain_failed", "ignored", "load_sites",
  "screen", "canRetry", "apiBase", "verificationUri", "pollMs", "isStaff", "currentSiteId", "lastSiteSlug",
  "queryAnchor", "queryFocus", "queryCompStart", "queryCompEnd", "userName",
  "sessionStatus", "previewUrl", "sessionError", "sessionStatusPath", "sessionHeartbeatPath", "sessionStopPath",
  "reloadToken", "afterRefresh", "afterStop",
] as const;
