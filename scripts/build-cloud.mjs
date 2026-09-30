import { build } from 'esbuild';

await build({
  entryPoints: ['cloud/index.ts'],
  outfile: 'cloudfunctions/ledger/index.js',
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  external: ['wx-server-sdk'],
  logLevel: 'info'
});
