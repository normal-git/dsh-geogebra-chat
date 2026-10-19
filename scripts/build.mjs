/**
 * Build both halves of the plugin:
 *
 * - host half   -> lib/index.js   (ESM, run by the DSH Loader in Node)
 * - client half -> lib/client.js  (lazy-CJS factory registered through
 *                                   window.__ModuleLoader__.load)
 *
 * The client output format is a hard contract of the DSH web shell: the script
 * only registers a factory, and the factory body is the whole bundle. Platform
 * modules (react, @deepseek-ai/cordis, ui-slots, ...) are external and resolved
 * through the `require` argument the shell hands the factory.
 */
import { build, context } from 'esbuild'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))

/** Module-table words the web shell seeds into every client bundle's `require`. */
const PLATFORM_MODULES = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  'zod',
  '@tanstack/react-virtual',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
]

const watch = process.argv.includes('--watch')

/** Host half: plain ESM for the Node-side Loader. */
const hostOptions = {
  entryPoints: [resolve(root, 'src/index.ts')],
  outfile: resolve(root, 'lib/index.js'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  // The host runtime already owns these singletons; bundling a copy would
  // break the module-private plugin-record commit binding.
  external: ['@deepseek-ai/*'],
  sourcemap: false,
  logLevel: 'info',
}

/** Client half: lazy-CJS factory consumed by window.__ModuleLoader__. */
const clientOptions = {
  entryPoints: [resolve(root, 'src/client/index.tsx')],
  outfile: resolve(root, 'lib/client.js'),
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  external: PLATFORM_MODULES,
  sourcemap: true,
  logLevel: 'info',
  banner: {
    js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(manifest.name)}, factory: (require) => {\nvar module = { exports: {} }; var exports = module.exports;`,
  },
  footer: {
    js: '\nreturn module.exports; } });',
  },
}

if (watch) {
  for (const options of [hostOptions, clientOptions]) {
    const ctx = await context(options)
    await ctx.watch()
    console.log(`[dsh-geogebra] watching ${options.entryPoints[0]}`)
  }
} else {
  await Promise.all([build(hostOptions), build(clientOptions)])
  console.log('[dsh-geogebra] built lib/index.js + lib/client.js')
}
