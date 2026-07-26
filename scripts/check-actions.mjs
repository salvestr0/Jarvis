/**
 * Guards against a Next.js rule that neither `tsc` nor `next build` enforces:
 *
 *   A file marked 'use server' may only export async functions.
 *
 * Every export in such a file becomes a callable server endpoint, so a plain
 * constant is rejected — but only at runtime, when the form is actually
 * rendered. We hit exactly that: build green, tests green, page broken.
 *
 * Type exports are fine (they disappear at compile time).
 *
 * Usage:  npm run check:actions
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const srcDir = join(root, 'src')

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (/\.(ts|tsx)$/.test(full)) out.push(full)
  }
  return out
}

const problems = []
let checked = 0

for (const file of walk(srcDir)) {
  const source = readFileSync(file, 'utf8')

  // Must be the very first statement in the file to take effect.
  if (!/^\s*['"]use server['"]/.test(source)) continue
  checked += 1

  source.split(/\r?\n/).forEach((line, i) => {
    if (!/^export\b/.test(line)) return

    // Allowed: async function declarations, and anything type-only.
    if (/^export\s+async\s+function\b/.test(line)) return
    if (/^export\s+(type|interface)\b/.test(line)) return
    if (/^export\s*\{[^}]*\}\s*from/.test(line) && /\btype\b/.test(line)) return

    problems.push({
      file: relative(root, file),
      line: i + 1,
      text: line.trim(),
    })
  })
}

if (problems.length === 0) {
  console.log(
    `check:actions — ${checked} 'use server' file${checked === 1 ? '' : 's'} checked, all exports are async functions.`
  )
} else {
  console.error("\ncheck:actions FAILED — non-async exports in 'use server' files:\n")
  for (const p of problems) {
    console.error(`  ${p.file}:${p.line}`)
    console.error(`    ${p.text}`)
  }
  console.error(
    '\nMove constants into a separate file (see src/lib/form-state.ts).\n'
  )
  process.exit(1)
}
