'use client'

import { useTransition } from 'react'
import { toast } from 'sonner'
import { EllipsisIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { emptyFormState } from '@/lib/form-state'

import { removeCategory } from './actions'
import type { CategoryOption } from './task-card'

export function ColumnMenu({
  category,
  taskCount,
  inboxLabel,
  canMoveLeft,
  canMoveRight,
  onMove,
  onRename,
}: {
  category: CategoryOption
  taskCount: number
  inboxLabel: string
  canMoveLeft: boolean
  canMoveRight: boolean
  onMove: (direction: -1 | 1) => void
  onRename: () => void
}) {
  const [pending, startTransition] = useTransition()

  function handleDelete() {
    const suffix =
      taskCount > 0
        ? ` Its ${taskCount === 1 ? 'task moves' : `${taskCount} tasks move`} to ${inboxLabel}.`
        : ''
    if (!confirm(`Delete "${category.name}"?${suffix}`)) return

    startTransition(async () => {
      const formData = new FormData()
      formData.set('id', category.id)
      const result = await removeCategory(emptyFormState, formData)
      if (result.error) toast.error(result.error)
      else toast.success('Category deleted')
      // No router.refresh(): the action's revalidatePath already returned
      // the updated page in the same response.
    })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Options for ${category.name}`}
          >
            <EllipsisIcon className="size-4" />
          </Button>
        }
      />
      {/* w-auto: the shared content style inherits the trigger's width via
          w-(--anchor-width), which for this icon button would be ~28px. */}
      <DropdownMenuContent align="end" className="w-auto min-w-44">
        <DropdownMenuItem onClick={onRename}>Rename</DropdownMenuItem>
        <DropdownMenuItem disabled={!canMoveLeft} onClick={() => onMove(-1)}>
          Move left
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!canMoveRight} onClick={() => onMove(1)}>
          Move right
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          disabled={pending}
          onClick={handleDelete}
        >
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
