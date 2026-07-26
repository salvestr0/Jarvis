import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { DeleteForm } from '@/components/delete-form'
import { PageHeader } from '@/components/page-header'
import { formatDayLabel } from '@/lib/date'
import { formatMoney } from '@/lib/money'
import { getJobs, getWins, monthlySalaryCents } from '@/lib/queries/career'

import { removeJob, removeWin } from './actions'
import { JobDialog, WinDialog } from './dialogs'

/** '2026-07-16' -> 'Jul 2026' */
function monthYear(iso: string): string {
  const [year, month] = iso.split('-')
  const name = new Intl.DateTimeFormat('en-SG', { month: 'short' }).format(
    new Date(Date.UTC(2000, Number(month) - 1, 1))
  )
  return `${name} ${year}`
}

export default async function CareerPage() {
  const [jobs, wins] = await Promise.all([getJobs(), getWins()])

  const current = jobs.find((j) => j.ended_on === null) ?? null
  const monthly = current ? monthlySalaryCents(current) : null

  return (
    <>
      <PageHeader
        title="Career"
        description="Your role, and a record of what you actually shipped."
        action={
          <div className="flex gap-2">
            <WinDialog
              jobs={jobs}
              trigger={<Button variant="outline">Log a win</Button>}
            />
            <JobDialog trigger={<Button>Add role</Button>} />
          </div>
        }
      />

      <div className="space-y-6">
        {/* --- roles --- */}
        {jobs.length === 0 ? (
          <div className="rounded-lg border border-dashed p-10 text-center">
            <p className="text-sm font-medium">No roles recorded</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Add your current job to start tracking salary and wins.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {jobs.map((job) => {
              const isCurrent = job.ended_on === null
              const perMonth = monthlySalaryCents(job)

              return (
                <Card key={job.id}>
                  <CardContent className="flex flex-wrap items-start justify-between gap-4 p-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="font-medium">{job.title}</h2>
                        {isCurrent ? <Badge>Current</Badge> : null}
                      </div>
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        {job.employer}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {monthYear(job.started_on)} —{' '}
                        {job.ended_on ? monthYear(job.ended_on) : 'present'}
                      </p>
                      {job.note ? (
                        <p className="mt-2 max-w-prose text-sm text-muted-foreground">
                          {job.note}
                        </p>
                      ) : null}
                    </div>

                    <div className="flex shrink-0 flex-col items-end gap-1">
                      {job.salary_cents === null ? (
                        <span className="text-sm text-muted-foreground">
                          Salary not recorded
                        </span>
                      ) : (
                        <>
                          <span className="text-lg font-semibold tabular-nums">
                            {formatMoney(job.salary_cents, job.salary_currency)}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            per {job.salary_period === 'annual' ? 'year' : 'month'}
                            {job.salary_period === 'annual' && perMonth !== null
                              ? ` · ${formatMoney(perMonth)}/mo`
                              : ''}
                          </span>
                        </>
                      )}
                      <div className="mt-1">
                        <JobDialog
                          existing={job}
                          trigger={
                            <Button variant="ghost" size="sm">
                              Edit
                            </Button>
                          }
                        />
                        <DeleteForm
                          action={removeJob}
                          id={job.id}
                          confirmText={`Delete the ${job.employer} role? Its wins will be deleted too.`}
                          successMessage="Role deleted"
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}

        {current && monthly !== null ? (
          <p className="text-xs text-muted-foreground">
            Your salary is not logged as income automatically — add it on the
            Money page each payday so cashflow reflects what actually landed.
          </p>
        ) : null}

        {/* --- wins --- */}
        <div>
          <h2 className="mb-3 text-sm font-medium">Wins log</h2>

          {wins.length === 0 ? (
            <div className="rounded-lg border border-dashed p-10 text-center">
              <p className="text-sm font-medium">Nothing logged yet</p>
              <p className="mt-1 max-w-md mx-auto text-sm text-muted-foreground">
                Every time you ship something at work, log it here. Writing it
                down now beats trying to remember it when you need a resume.
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {wins.map((win) => {
                const job = jobs.find((j) => j.id === win.job_id) ?? null
                return (
                  <li key={win.id}>
                    <Card>
                      <CardContent className="flex items-start justify-between gap-4 p-4">
                        <div className="min-w-0">
                          <p className="font-medium">{win.title}</p>
                          {win.detail ? (
                            <p className="mt-1 max-w-prose text-sm text-muted-foreground">
                              {win.detail}
                            </p>
                          ) : null}
                          <p className="mt-1.5 text-xs text-muted-foreground">
                            {formatDayLabel(win.occurred_on)}{' '}
                            {win.occurred_on.slice(0, 4)}
                            {job ? ` · ${job.employer}` : ''}
                          </p>
                        </div>
                        <DeleteForm
                          action={removeWin}
                          id={win.id}
                          confirmText="Delete this win?"
                          successMessage="Win deleted"
                        />
                      </CardContent>
                    </Card>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </>
  )
}
