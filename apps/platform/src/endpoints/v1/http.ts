import type { PayloadRequest } from 'payload'

export const json = (body: unknown, status = 200): Response => Response.json(body, { status })

export const error = (status: number, code: string, message?: string): Response =>
  json({ error: code, ...(message ? { message } : {}) }, status)

export async function readJson(req: PayloadRequest): Promise<Record<string, unknown>> {
  try {
    const body = req.json ? await req.json() : null
    return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

export const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined)
