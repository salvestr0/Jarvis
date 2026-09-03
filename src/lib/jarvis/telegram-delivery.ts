export type TelegramDeliveryDeps<Db> = {
  createLeaseToken(): string
  getDb(): Promise<Db>
  claim(db: Db, updateId: number, leaseToken: string): Promise<boolean>
}

/**
 * Claim an update before the webhook acknowledges it. If the database is
 * unavailable this rejects, allowing Telegram to redeliver instead of losing
 * the update after an early 200 response.
 */
export async function prepareTelegramDelivery<Db>(
  updateId: number,
  deps: TelegramDeliveryDeps<Db>
): Promise<{ db: Db; leaseToken: string } | null> {
  const leaseToken = deps.createLeaseToken()
  const db = await deps.getDb()
  const claimed = await deps.claim(db, updateId, leaseToken)
  return claimed ? { db, leaseToken } : null
}

export async function prepareJarvisDelivery<Db>(
  backend: string,
  updateId: number,
  deps: TelegramDeliveryDeps<Db>
): Promise<
  | { backend: 'legacy' }
  | { backend: 'hermes'; db: Db; leaseToken: string }
  | null
> {
  if (backend === 'legacy') return { backend }
  if (backend !== 'hermes') throw new Error('Unknown Jarvis agent backend.')
  const delivery = await prepareTelegramDelivery(updateId, deps)
  return delivery ? { backend, ...delivery } : null
}
