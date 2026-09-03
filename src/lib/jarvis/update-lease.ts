type RpcResult = {
  data: boolean | null
  error: { message: string } | null
}

type LeaseDb = {
  userId: string
  client: unknown
}

type RpcClient = {
  rpc(name: string, args: Record<string, unknown>): Promise<RpcResult>
}

function assertUpdateId(updateId: number) {
  if (!Number.isSafeInteger(updateId) || updateId < 0) {
    throw new Error('Telegram update_id must be a non-negative safe integer.')
  }
}

export async function claimTelegramUpdate(
  db: LeaseDb,
  updateId: number,
  leaseToken: string,
  leaseSeconds = 300
): Promise<boolean> {
  assertUpdateId(updateId)
  const client = db.client as RpcClient
  const { data, error } = await client.rpc('claim_telegram_update', {
    p_user_id: db.userId,
    p_update_id: updateId,
    p_lease_token: leaseToken,
    p_lease_seconds: leaseSeconds,
  })
  if (error) throw new Error(`Could not claim Telegram update: ${error.message}`)
  return data === true
}

export async function finishTelegramUpdate(
  db: LeaseDb,
  updateId: number,
  leaseToken: string,
  result: { succeeded: boolean; error?: string }
): Promise<boolean> {
  assertUpdateId(updateId)
  const client = db.client as RpcClient
  const { data, error } = await client.rpc('finish_telegram_update', {
    p_user_id: db.userId,
    p_update_id: updateId,
    p_lease_token: leaseToken,
    p_succeeded: result.succeeded,
    p_error: result.error ?? null,
  })
  if (error) throw new Error(`Could not finish Telegram update: ${error.message}`)
  return data === true
}
