import { describe, expect, test } from 'bun:test'

import { describeToolUse } from '../src/lib/sessions/agent'

describe('agent tool notes', () => {
  test('edits and commands read plainly; browsing around stays out of the chat', () => {
    expect(describeToolUse('Edit', { file_path: '/vercel/sandbox/site/src/app/page.tsx' })).toBe('Edited src/app/page.tsx')
    expect(describeToolUse('Write', { file_path: '/vercel/sandbox/site/README.md' })).toBe('Wrote README.md')
    expect(describeToolUse('Bash', { command: 'bun run lint\nmore' })).toBe('Ran `bun run lint`')
    expect(describeToolUse('Read', { file_path: 'x' })).toBeNull()
    expect(describeToolUse('Grep', {})).toBeNull()
    expect(describeToolUse('WebFetch', {})).toBe('Used WebFetch')
  })
})
