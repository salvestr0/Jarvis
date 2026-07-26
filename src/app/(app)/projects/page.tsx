import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { DeleteForm } from '@/components/delete-form'
import { PageHeader } from '@/components/page-header'
import { formatMoney } from '@/lib/money'
import {
  getMetrics,
  getProjects,
  withProgress,
  type ProjectWithProgress,
} from '@/lib/queries/projects'

import { removeProject } from './actions'
import { MetricDialog, ProjectDialog } from './dialogs'

function ProjectCard({ project }: { project: ProjectWithProgress }) {
  const hasTarget = project.mrr_target_cents > 0

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-medium">{project.name}</h2>
              <Badge variant="secondary">{project.status}</Badge>
              {project.kind !== 'product' ? (
                <Badge variant="outline">{project.kind}</Badge>
              ) : null}
            </div>
            {project.note ? (
              <p className="mt-1 max-w-prose text-sm text-muted-foreground">
                {project.note}
              </p>
            ) : null}
          </div>

          <div className="shrink-0">
            <MetricDialog
              project={project}
              trigger={
                <Button variant="outline" size="sm">
                  Update numbers
                </Button>
              }
            />
          </div>
        </div>

        {hasTarget ? (
          <div className="mt-4">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="tabular-nums font-medium">
                {formatMoney(project.currentMrrCents)}
                <span className="text-muted-foreground">
                  {' '}
                  / {formatMoney(project.mrr_target_cents)} MRR
                </span>
              </span>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {(project.progressPct ?? 0).toFixed(0)}%
              </span>
            </div>
            <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${project.progressPct ?? 0}%`,
                  backgroundColor: 'var(--viz-bar)',
                }}
              />
            </div>
          </div>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">
            No revenue target — tracked for progress, not money.
          </p>
        )}

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            {project.metricAsOf
              ? `Last updated ${project.metricAsOf}`
              : 'No numbers logged yet'}
            {project.usersCount !== null
              ? ` · ${project.usersCount} user${project.usersCount === 1 ? '' : 's'}`
              : ''}
            {project.launch_date ? ` · launches ${project.launch_date}` : ''}
          </p>

          <div className="shrink-0">
            {project.url ? (
              <Button
                render={
                  <a href={project.url} target="_blank" rel="noopener noreferrer" />
                }
                nativeButton={false}
                variant="ghost"
                size="sm"
              >
                Visit
              </Button>
            ) : null}
            <ProjectDialog
              existing={project}
              trigger={
                <Button variant="ghost" size="sm">
                  Edit
                </Button>
              }
            />
            <DeleteForm
              action={removeProject}
              id={project.id}
              confirmText={`Delete "${project.name}"? Its logged numbers go too.`}
              successMessage="Project deleted"
            />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export default async function ProjectsPage() {
  const [projects, metrics] = await Promise.all([getProjects(), getMetrics()])
  const withMetrics = withProgress(projects, metrics)

  const revenueProjects = withMetrics.filter((p) => p.mrr_target_cents > 0)

  const totalMrr = revenueProjects.reduce((s, p) => s + p.currentMrrCents, 0)
  const totalTarget = revenueProjects.reduce(
    (s, p) => s + p.mrr_target_cents,
    0
  )

  return (
    <>
      <PageHeader
        title="Projects"
        description="Where each thing stands, and how far off the target you are."
        action={<ProjectDialog trigger={<Button>Add project</Button>} />}
      />

      <div className="space-y-6">
        {revenueProjects.length > 0 ? (
          <Card>
            <CardContent className="p-4">
              <p className="text-xs font-medium text-muted-foreground">
                Combined MRR
              </p>
              <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">
                {formatMoney(totalMrr)}
                <span className="ml-2 text-base font-normal text-muted-foreground">
                  of {formatMoney(totalTarget)} target
                </span>
              </p>
              <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${totalTarget > 0 ? Math.min(100, (totalMrr / totalTarget) * 100) : 0}%`,
                    backgroundColor: 'var(--viz-bar)',
                  }}
                />
              </div>
            </CardContent>
          </Card>
        ) : null}

        {withMetrics.length === 0 ? (
          <div className="rounded-lg border border-dashed p-10 text-center">
            <p className="text-sm font-medium">No projects yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Add one to start tracking it against a target.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {withMetrics.map((p) => (
              <ProjectCard key={p.id} project={p} />
            ))}
          </div>
        )}
      </div>
    </>
  )
}
