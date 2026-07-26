'use client'

import { ThemeProvider as NextThemesProvider } from 'next-themes'

/**
 * attribute="class" toggles the `.dark` class that globals.css keys off.
 * defaultTheme="system" respects the OS setting until you pick one yourself;
 * the choice persists in localStorage.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  )
}
