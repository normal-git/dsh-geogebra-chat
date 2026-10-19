/**
 * Compact knowledge about GeoGebra app modes.
 *
 * Kept out of the system prompt so the prompt stays short: the Agent can ask
 * for this catalog only when it needs to choose a mode.
 */

export interface AppMode {
  readonly id: string
  readonly label: string
  readonly summary: string
  readonly examples: readonly string[]
  readonly note?: string
}

export const MODES: readonly AppMode[] = [
  {
    id: 'suite',
    label: 'Suite',
    summary: 'Modern full app: algebra, graphics, CAS, spreadsheet and 3D in one window. Best default for mixed work.',
    examples: ['f(x)=x^2', 'A=(1,2)', 'c=Circle(A,3)'],
  },
  {
    id: 'classic',
    label: 'Classic',
    summary: 'Older full UI with a menu bar. Same command coverage as suite, classic look.',
    examples: ['A=(0,0)', 'B=(2,0)', 'Polygon(A,B,4)'],
  },
  {
    id: 'graphing',
    label: 'Graphing',
    summary: 'Function graphing. Geometry commands such as Segment, Distance or Circle are not available.',
    examples: ['f(x)=x^2-4x+3', 'V=Extremum(f)', 'R=Root(f)'],
  },
  {
    id: 'geometry',
    label: 'Geometry',
    summary: 'Geometric constructions: points, lines, circles, polygons, intersections, transformations.',
    examples: ['A=(0,0)', 'B=(2,0)', 'c=Circle(A,B)', 'd=PerpendicularLine(B,c)'],
  },
  {
    id: '3d',
    label: '3D',
    summary: '3D view and solids. Use uppercase points; a lowercase label becomes a vector.',
    examples: ['A=(0,0,0)', 'B=(2,0,0)', 'C=(2,2,0)', 'cube=Cube(A,B,C)', 'Sphere((0,0,0),2)'],
    note: '3D uses the T/AT perspective; charts are drawn in the 3D view.',
  },
  {
    id: 'scientific',
    label: 'Scientific',
    summary: 'Scientific calculator for numeric work. Not for constructions.',
    examples: ['sin(30°)', '2^10'],
  },
  {
    id: 'evaluator',
    label: 'Evaluator',
    summary: 'Quick numeric evaluation. Not for constructions.',
    examples: ['1/3+1/4'],
  },
  {
    id: 'notes',
    label: 'Notes',
    summary: 'Notes/documents. Not a construction app.',
    examples: [],
  },
]

/** Commands that only make sense in the 3D app. */
const COMMANDS_3D = new Set([
  'Cube', 'Tetrahedron', 'Octahedron', 'Dodecahedron', 'Icosahedron',
  'Prism', 'Pyramid', 'Sphere', 'Cylinder', 'Cone', 'Plane', 'Polyhedron',
  'Surface', 'Curve', 'Net', 'Volume',
])

/** A coordinate triple such as `(0, 0, 2)` means 3D. */
const COORD_3D = /\(\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*\)/

/** Pick an app when the model did not specify one. Only 3D is inferred. */
export function inferApp(commands: readonly string[]): string {
  for (const line of commands) {
    if (COORD_3D.test(line)) return '3d'
    const name = /\b([A-Z][A-Za-z0-9]*)\s*\(/.exec(line)?.[1]
    if (name !== undefined && COMMANDS_3D.has(name)) return '3d'
  }
  return 'suite'
}

/** One-line hint for a mode, used in tool results. Empty for ordinary modes. */
export function modeNote(appName: string): string {
  if (appName !== '3d') return ''
  return '模式：3D（大写点，例如 A=(0,0,0)；小写标签会被当成向量）。'
}

/** Full catalog for the Agent, one line per mode. */
export function catalogText(): string {
  return MODES.map(mode => `${mode.id} — ${mode.summary}`).join('\n')
}

/** Details for one mode. */
export function modeText(appName: string): string {
  const mode = MODES.find(item => item.id === appName)
  if (mode === undefined) return ''
  const lines = [`${mode.id} (${mode.label}): ${mode.summary}`]
  if (mode.examples.length > 0) lines.push(`示例：${mode.examples.join('；')}`)
  if (mode.note !== undefined) lines.push(mode.note)
  return lines.join('\n')
}
