import type { Plugin } from 'payload'

/**
 * Payload 4 turns on versions and authorship (createdBy/updatedBy) for every
 * collection unless told otherwise. None of ours want either: they would add
 * version tables and user relationships to token and session records. Opt in
 * per collection by setting `versions` or `authorship` on it (same policy as
 * yimby-website's preserveV3Defaults).
 */
export const preserveV3Defaults: Plugin = (config) => {
  for (const entity of [...(config.collections ?? []), ...(config.globals ?? [])]) {
    entity.authorship ??= false
    entity.versions ??= false
  }
  return config
}
