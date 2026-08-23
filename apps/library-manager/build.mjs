// Builds the custom app into dist/, which is what spicetify's CustomApps
// directory links to.
//
// Spicetify's contract for a custom app is narrow: it takes the bundle in
// CustomApps/<name>/index.js verbatim and wraps it in a chunk that re-exports
// a top-level binding called `render` as the module default. So the bundle has
// to be an IIFE that leaves no imports behind, and the footer has to declare
// that binding. Nothing may be an ES module at the top level.
import { build, context } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DIST = join(ROOT, 'dist');
const WATCH = process.argv.includes('--watch');

await rm(DIST, { recursive: true, force: true });
await mkdir(DIST, { recursive: true });

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: [join(ROOT, 'src/index.tsx')],
  outfile: join(DIST, 'index.js'),
  bundle: true,
  format: 'iife',
  globalName: 'libraryManager',
  platform: 'browser',
  target: 'es2020',
  // React comes from the client, never from a bundled copy: two Reacts in one
  // page do not share hook state and every hook would throw.
  jsx: 'transform',
  jsxFactory: 'Spicetify.React.createElement',
  jsxFragment: 'Spicetify.React.Fragment',
  minify: !WATCH,
  sourcemap: WATCH ? 'inline' : false,
  legalComments: 'none',
  logLevel: 'info',
  footer: { js: 'const render = () => libraryManager.default();' },
};

const copyStatic = async () => {
  await cp(join(ROOT, 'manifest.json'), join(DIST, 'manifest.json'));
  await cp(join(ROOT, 'src/style.css'), join(DIST, 'style.css'));
};

if (WATCH) {
  await copyStatic();
  const ctx = await context(options);
  await ctx.watch();
  console.log('[library-manager] watching');
} else {
  await build(options);
  await copyStatic();
  console.log('[library-manager] built -> dist/');
}
