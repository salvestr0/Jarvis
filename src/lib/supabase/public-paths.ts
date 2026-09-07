const PUBLIC_PATHS = [
  '/login',
  '/auth',
  '/api/cron',
  '/api/telegram',
  '/api/reminders',
  '/api/mcp',
]

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`)
  )
}
