import { build } from 'esbuild';

// 把 TypeScript 云函数入口打包成微信开发者工具部署目录中的 CommonJS 文件。
// wx-server-sdk 保持 external，由云函数运行环境提供，避免把运行时 SDK 打进产物。
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
