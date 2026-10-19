/**
 * Offline command-name lint for GeoGebra input.
 *
 * The name list is generated from the official GeoGebra manual (see
 * `command-names.json`, which records its source and generation date). It is
 * used only to catch a likely typo *before* a board is created: an unknown name
 * with a close match is rejected with a suggestion, while an unknown name with
 * no close match is allowed through so newer or localized commands still work.
 */
import data from './command-names.json'

/** Official command names, e.g. `Circle`, `Midpoint`, `SetColor`. */
const NAMES: readonly string[] = (data as { names: string[] }).names
const KNOWN = new Set(NAMES)

/** One suspicious command name found in a command list. */
export interface LintIssue {
  readonly command: string
  readonly unknown: string
  readonly suggestion?: string
}

/** Levenshtein distance, bounded by the two strings' lengths. */
function distance(left: string, right: string): number {
  const a = left.toLowerCase()
  const b = right.toLowerCase()
  const rows = a.length + 1
  const columns = b.length + 1
  let previous = Array.from({ length: columns }, (_, index) => index)
  for (let row = 1; row < rows; row += 1) {
    const current = [row]
    for (let column = 1; column < columns; column += 1) {
      const substitution = previous[column - 1] + (a[row - 1] === b[column - 1] ? 0 : 1)
      current[column] = Math.min(previous[column] + 1, current[column - 1] + 1, substitution)
    }
    previous = current
  }
  return previous[columns - 1]
}

/** Closest official name within a small edit distance, or undefined. */
function suggest(name: string): string | undefined {
  if (name.length < 3) return undefined
  let best: string | undefined
  let bestDistance = 3
  for (const candidate of NAMES) {
    // Quick length filter: a distance of 2 cannot bridge a bigger gap.
    if (Math.abs(candidate.length - name.length) > 2) continue
    const value = distance(name, candidate)
    if (value < bestDistance) {
      bestDistance = value
      best = candidate
    }
  }
  return bestDistance <= 2 ? best : undefined
}

/** Extract `Name(` / `Name[` candidates from one command line. */
function candidates(line: string): string[] {
  const found: string[] = []
  const pattern = /\b([A-Z][A-Za-z0-9]*)\s*[([\]]/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(line)) !== null) found.push(match[1])
  return found
}

/**
 * Find likely command-name typos in a command list.
 * @param commands - one command per line.
 * @returns one issue per unknown name that has a close official match.
 */
export function lintCommands(commands: readonly string[]): LintIssue[] {
  const issues = new Map<string, LintIssue>()
  for (const line of commands) {
    for (const name of candidates(line)) {
      if (KNOWN.has(name)) continue
      const suggestion = suggest(name)
      if (suggestion === undefined) continue
      if (!issues.has(name)) issues.set(name, { command: line, unknown: name, suggestion })
    }
  }
  return [...issues.values()]
}

/** Number of names in the offline list (for diagnostics). */
export const COMMAND_COUNT = NAMES.length

/**
 * Find commands that paint an object white or near-white.
 * Such an object is invisible on the white board, which reads as "nothing was
 * drawn", so these are blocked before execution.
 * @param commands - one command per line.
 * @returns the offending command lines.
 */
export function findWhiteColors(commands: readonly string[]): string[] {
  const hits: string[] = []
  for (const line of commands) {
    const named = /SetColor\s*\(\s*[^,)]+\s*,\s*["']?(white|白)["']?\s*\)/i.test(line)
    const rgb = /SetColor\s*\(\s*[^,)]+\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/.exec(line)
    const nearWhite = rgb !== null
      && Number(rgb[1]) >= 230 && Number(rgb[2]) >= 230 && Number(rgb[3]) >= 230
    const hex = /#[fF]{6}\b|#[fF]{3}\b/.test(line)
    if (named || nearWhite || hex) hits.push(line)
  }
  return hits
}
