export function PageHeader({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: React.ReactNode
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}

/**
 * Shown where real data will go, before that module is built.
 * Deliberately looks intentional rather than broken — an empty screen with
 * no explanation reads as a bug.
 */
export function ComingSoon({ phase, what }: { phase: string; what: string }) {
  return (
    <div className="rounded-lg border border-dashed p-10 text-center">
      <p className="text-sm font-medium">{what}</p>
      <p className="mt-1 text-sm text-muted-foreground">
        Being built in {phase}.
      </p>
    </div>
  )
}
