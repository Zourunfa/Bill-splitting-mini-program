import { defineConfig } from '@tarojs/cli';

// 此配置在构建时注入前端。这里绝不能放 AppSecret、数据库密码或 JWT 密钥。
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
  defineConstants: {
    // 这两个值会进入小程序包；Java 登录密钥等敏感配置只放在服务端环境变量中。
    CLOUD_ENV: JSON.stringify(process.env.TARO_APP_CLOUD_ENV || ''),
    API_BASE_URL: JSON.stringify(process.env.TARO_APP_API_BASE_URL || '')
  },
  mini: { postcss: { pxtransform: { enable: true }, cssModules: { enable: false } } },
  h5: { publicPath: '/', router: { mode: 'hash' }, devServer: { host: '127.0.0.1', port: 10086 } }
});
