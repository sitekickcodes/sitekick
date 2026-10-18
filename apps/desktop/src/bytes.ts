// Byte helpers for the core, which has no string concatenation or JSON.

export function joined(parts: readonly Uint8Array[]): Uint8Array {
  let length = 0;
  for (const part of parts) length += part.length;
  const out = new Uint8Array(length);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function newlineAt(bytes: Uint8Array): number {
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 10) return i;
  }
  return -1;
}

function copyRange(bytes: Uint8Array, from: number, to: number): Uint8Array {
  const out = new Uint8Array(to - from);
  for (let i = from; i < to; i++) out[i - from] = bytes[i] ?? 0;
  return out;
}

/** The part of `bytes` before the first newline, or all of it. */
export function beforeNewline(bytes: Uint8Array): Uint8Array {
  const at = newlineAt(bytes);
  return at < 0 ? bytes : copyRange(bytes, 0, at);
}

/** The part of `bytes` after the first newline, or nothing. */
export function afterNewline(bytes: Uint8Array): Uint8Array {
  const at = newlineAt(bytes);
  return at < 0 ? new Uint8Array(0) : copyRange(bytes, at + 1, bytes.length);
}
