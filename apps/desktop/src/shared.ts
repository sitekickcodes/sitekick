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
}

export type SitesResult = {
  readonly sites: readonly Site[];
};
