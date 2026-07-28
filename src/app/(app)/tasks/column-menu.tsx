'use client'

import { useState, useTransition } from 'react'
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
import { CategoryDialog } from './dialogs'
import type { CategoryOption } from './task-card'

export function ColumnMenu({
  category,
  taskCount,
  canMoveLeft,
  canMoveRight,
  onMove,
}: {
  category: CategoryOption
  taskCount: number
  canMoveLeft: boolean
  canMoveRight: boolean
  onMove: (direction: -1 | 1) => void
}) {
  const [renaming, setRenaming] = useState(false)
  const [pending, startTransition] = useTransition()

  function handleDelete() {
    const suffix =
      taskCount > 0
        ? ` Its ${taskCount === 1 ? 'task moves' : `${taskCount} tasks move`} to Uncategorised.`
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
    <>
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
          <DropdownMenuItem onClick={() => setRenaming(true)}>
            Rename
          </DropdownMenuItem>
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

      {/* Sibling of the menu, not a child: menu content unmounts on close,
          which would take the dialog down with it. */}
      <CategoryDialog
        existing={category}
        open={renaming}
        onOpenChange={setRenaming}
      />
    </>
  )
}
