import { cn } from '@/lib/utils'

/**
 * A plain native <select>, styled to match the shadcn inputs.
 *
 * Deliberately native rather than a custom dropdown component: it submits with
 * the form without extra wiring, and on your phone it opens the OS picker,
 * which is far nicer to use one-handed than a rendered listbox.
 */
export function NativeSelect({
  className,
  ...props
}: React.ComponentProps<'select'>) {
  return (
    <select
      className={cn(
        'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-[color,box-shadow]',
        'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    />
  )
}
