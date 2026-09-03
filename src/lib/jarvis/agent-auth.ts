import { timingSafeEqual } from 'node:crypto'

export function isAuthorizedAgentRequest(headers: Headers, configuredSecret: string | undefined) {
  if (!configuredSecret || configuredSecret.length < 32) return false
  const authorization = headers.get('authorization')
  if (!authorization?.startsWith('Bearer ')) return false
  const supplied = authorization.slice('Bearer '.length)
  const expectedBytes = Buffer.from(configuredSecret)
  const suppliedBytes = Buffer.from(supplied)
  return (
    expectedBytes.length === suppliedBytes.length &&
    timingSafeEqual(expectedBytes, suppliedBytes)
  )
}
