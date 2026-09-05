import { describe, it, expect } from 'vitest'
import { hashPassword, verifyPassword, needsRehash, BCRYPT_COST } from '@/lib/auth/passwords'

describe('password hashing', () => {
  it('new hashes use BCRYPT_COST', async () => {
    const h = await hashPassword('correct horse battery staple')
    // bcrypt format: $2a$<cost>$<salt+hash>
    expect(h).toMatch(new RegExp(`^\\$2[abxy]\\$${BCRYPT_COST}\\$`))
  })

  it('verifyPassword accepts the correct password and rejects a wrong one', async () => {
    const h = await hashPassword('rightpass')
    expect(await verifyPassword('rightpass', h)).toBe(true)
    expect(await verifyPassword('wrongpass', h)).toBe(false)
  })

  it('needsRehash returns true for a legacy cost-10 hash', () => {
    // A real cost-10 hash produced by bcryptjs.
    const legacy = '$2a$10$abcdefghijklmnopqrstuOOKvJ7yWQyMi.tR7BbAHYKVjmJvVQjqK'
    expect(needsRehash(legacy)).toBe(true)
  })

  it('needsRehash returns false for a fresh hash', async () => {
    const h = await hashPassword('x')
    expect(needsRehash(h)).toBe(false)
  })

  it('needsRehash treats unknown formats as needing upgrade', () => {
    expect(needsRehash('not-a-bcrypt-hash')).toBe(true)
  })
})
