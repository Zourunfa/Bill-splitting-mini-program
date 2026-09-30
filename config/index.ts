import { defineConfig } from '@tarojs/cli';

export default defineConfig<'vite'>({
  projectName: 'jiqian-mini',
  date: '2026-09-30',
  designWidth: 750,
  deviceRatio: { 640: 2.34 / 2, 750: 1, 828: 1.81 / 2 },
  sourceRoot: 'src',
  outputRoot: process.env.TARO_ENV === 'h5' ? 'dist-h5' : 'dist',
  framework: 'react',
  compiler: 'vite',
  plugins: ['@tarojs/plugin-platform-weapp', '@tarojs/plugin-platform-h5'],
  defineConstants: { CLOUD_ENV: JSON.stringify(process.env.TARO_APP_CLOUD_ENV || '') },
  mini: { postcss: { pxtransform: { enable: true }, cssModules: { enable: false } } },
  h5: { publicPath: '/', router: { mode: 'hash' }, devServer: { host: '127.0.0.1', port: 10086 } }
});
