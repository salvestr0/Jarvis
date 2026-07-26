import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { DeleteForm } from '@/components/delete-form'
import { PageHeader } from '@/components/page-header'
import { todayISO } from '@/lib/date'
import { getGoals, type Goal } from '@/lib/queries/goals'

import { removeGoal } from './actions'
import { AchieveButton, GoalDialog } from './dialogs'

function GoalCard({ goal }: { goal: Goal }) {
  const overdue =
    goal.status === 'active' &&
    goal.target_date !== null &&
    goal.target_date < todayISO()

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-medium">{goal.title}</h3>
              {goal.status !== 'active' ? (
                <Badge
                  variant={goal.status === 'achieved' ? 'default' : 'secondary'}
                >
                  {goal.status}
                </Badge>
              ) : null}
              {overdue ? <Badge variant="destructive">past target</Badge> : null}
            </div>
            {goal.note ? (
              <p className="mt-1 max-w-prose text-sm text-muted-foreground">
                {goal.note}
              </p>
            ) : null}
            {goal.target_date ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Target: {goal.target_date}
              </p>
            ) : null}
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {goal.status === 'active' ? <AchieveButton goal={goal} /> : null}
            <GoalDialog
              existing={goal}
              trigger={
                <Button variant="ghost" size="sm">
                  Edit
                </Button>
              }
            />
            <DeleteForm
              action={removeGoal}
              id={goal.id}
              confirmText={`Delete "${goal.title}"? Tasks linked to it stay, but lose the link.`}
              successMessage="Goal deleted"
            />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function GoalSection({
  title,
  description,
  goals,
}: {
  title: string
  description: string
  goals: Goal[]
}) {
  return (
    <section>
      <h2 className="text-sm font-semibold">{title}</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      {goals.length === 0 ? (
        <div className="mt-3 rounded-lg border border-dashed p-6 text-center">
          <p className="text-sm text-muted-foreground">
            Nothing here yet — add one above.
          </p>
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          {goals.map((g) => (
            <GoalCard key={g.id} goal={g} />
          ))}
        </div>
      )}
    </section>
  )
}

export default async function GoalsPage() {
  const goals = await getGoals()

  const active = goals.filter((g) => g.status === 'active')
  const finished = goals.filter((g) => g.status !== 'active')

  const shortTerm = active.filter((g) => g.horizon === 'short')
  const longTerm = active.filter((g) => g.horizon === 'long')

  return (
    <>
      <PageHeader
        title="Goals"
        description="What you're aiming at — near-term targets and the big picture."
        action={<GoalDialog trigger={<Button>Add goal</Button>} />}
      />

      <div className="space-y-8">
        <GoalSection
          title="Short term"
          description="The next few weeks or months."
          goals={shortTerm}
        />
        <GoalSection
          title="Long term"
          description="The destination everything else serves."
          goals={longTerm}
        />

        {finished.length > 0 ? (
          <section>
            <h2 className="text-sm font-semibold">Finished</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Achieved or dropped — kept so you can see how far you&apos;ve come.
            </p>
            <div className="mt-3 space-y-3 opacity-70">
              {finished.map((g) => (
                <GoalCard key={g.id} goal={g} />
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </>
  )
}
