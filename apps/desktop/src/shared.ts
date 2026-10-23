// Records that cross between the core and the `api` service. Both sides
// import this one module, and `native check` derives the typed service
// client from it.

/** Raw response bytes for the service to decode. */
export type ParseRequest = {
  readonly body: Uint8Array;
};

/**
 * A token response, already shaped for the keychain: `session` is
 * `<refreshToken>\n<accessToken>`, stored as one credential and never kept
 * in the Model.
 */
export type TokensResult = {
  readonly session: Uint8Array;
  readonly userName: Uint8Array;
  readonly userEmail: Uint8Array;
  readonly isStaff: boolean;
};

export type DeviceStart = {
  readonly deviceCode: Uint8Array;
  readonly userCode: Uint8Array;
  readonly verificationUri: Uint8Array;
  readonly intervalMs: number;
};

/** One site the signed-in person can open. An interface: the Model keeps an array of them. */
export interface Site {
  readonly id: number;
  readonly name: Uint8Array;
  readonly slug: Uint8Array;
  readonly orgName: Uint8Array;
  readonly productionUrl: Uint8Array;
  readonly role: Uint8Array;
  /** `/api/v1/sites/<id>/sessions`, prebuilt so the core never formats numbers into URLs. */
  readonly sessionsPath: Uint8Array;
}

export type SitesResult = {
  readonly sites: readonly Site[];
};

/** Mirrors the platform's session statuses. */
export type SessionStatus =
  | "starting"
  | "branching"
  | "booting"
  | "installing"
  | "migrating"
  | "starting_server"
  | "ready"
  | "failed"
  | "stopped";

export type SessionInfo = {
  readonly status: SessionStatus;
  readonly previewUrl: Uint8Array;
  readonly problem: Uint8Array;
  readonly statusPath: Uint8Array;
  readonly heartbeatPath: Uint8Array;
  readonly stopPath: Uint8Array;
  readonly messagesPath: Uint8Array;
  readonly undoPath: Uint8Array;
  readonly agentWorking: boolean;
};

export type OpenBrowserRequest = {
  readonly url: Uint8Array;
};

export type OpenBrowserResult = {
  readonly opened: boolean;
};

export type ChatRole = "user" | "assistant" | "tool" | "notice";

/** One chat line. An interface: the Model keeps an array of them. */
export interface ChatMessage {
  /** The message id as text, for list keys. */
  readonly key: Uint8Array;
  readonly role: ChatRole;
  readonly text: Uint8Array;
}

export type ChatResult = {
  readonly messages: readonly ChatMessage[];
  /** The path for the next poll (`.../messages?after=<last id>`). */
  readonly nextPath: Uint8Array;
  readonly agentWorking: boolean;
};

export type PromptRequest = {
  readonly text: Uint8Array;
};

export type PromptBody = {
  readonly body: Uint8Array;
};
