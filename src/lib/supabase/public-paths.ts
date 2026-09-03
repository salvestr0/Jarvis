const PUBLIC_SERVER_PATHS = [
  '/login',
  '/auth',
  '/api/agent',
  '/api/cron',
  '/api/telegram',
  '/api/reminders',
]

export function isPublicServerPath(pathname: string): boolean {
  return PUBLIC_SERVER_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`)
  )
}
