/**
 * pm2 ecosystem — EatCheck Staging
 *
 * 启动两个进程：
 *   1. api-server-staging：HTTP 服务（监听 PORT，默认 3006）
 *   2. api-worker-staging：BullMQ Worker（不监听 HTTP，处理后台任务）
 *
 * 部署：
 *   pm2 startOrReload ecosystem.staging.config.cjs --update-env
 *
 * 单独重启：
 *   pm2 reload api-server-staging
 *   pm2 reload api-worker-staging
 *
 * 查看日志：
 *   pm2 logs api-server-staging
 *
 * 设计要点：
 *   - exec_mode: cluster + instances:1
 *     pm2 cluster 模式可零停机 reload；单实例避免内存中状态（OTP 已迁 Redis 但保险起见）
 *   - kill_timeout: 30000
 *     给 NestJS shutdown hooks（Prisma/Redis/BullMQ 优雅断开）足够时间，避免 Cron/队列任务被强杀
 *   - wait_ready + listen_timeout
 *     依赖 main.ts 调用 process.send('ready')；当前未调用，因此走 listen_timeout 兜底
 *   - max_memory_restart
 *     防止内存泄漏拖垮 VM；Cloud Run 镜像设置了 NODE_OPTIONS=--max-old-space-size=768，这里同步
 *   - log 轮转交给 pm2 logrotate 模块（VM 上一次性 `pm2 install pm2-logrotate` 即可）
 */

const path = require('path');

// 共享配置（main + worker）
const sharedNodeArgs = ['--max-old-space-size=768'];
const sharedEnvFile = path.resolve(__dirname, '.env');

const baseProcess = {
  cwd: __dirname,
  exec_mode: 'fork', // worker 用 fork；主服务下方覆盖为 cluster
  instances: 1,
  autorestart: true,
  watch: false,
  max_memory_restart: '900M',
  kill_timeout: 30000, // 30s — 给 graceful shutdown 充足时间
  listen_timeout: 15000, // 15s — pm2 等待进程就绪
  wait_ready: false, // main.ts 未调用 process.send('ready')；如果以后接入可改 true
  // pm2 自动注入 NODE_APP_INSTANCE / PM2_HOME 等
  env: {
    NODE_ENV: 'staging',
    NODE_OPTIONS: sharedNodeArgs.join(' '),
  },
  // 日志：合并 stdout+stderr，方便 pm2 logs 查看
  merge_logs: true,
  log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS Z',
  out_file: path.resolve(__dirname, 'logs/pm2-out.log'),
  error_file: path.resolve(__dirname, 'logs/pm2-error.log'),
};

module.exports = {
  apps: [
    {
      ...baseProcess,
      name: 'api-server-staging',
      script: 'dist/main.js',
      exec_mode: 'cluster', // 主服务用 cluster 支持零停机 reload
      instances: 1,
      env: {
        ...baseProcess.env,
        PORT: process.env.PORT || 3006,
      },
      // staging 专用日志路径
      out_file: path.resolve(__dirname, 'logs/api-server-out.log'),
      error_file: path.resolve(__dirname, 'logs/api-server-error.log'),
    },
    {
      ...baseProcess,
      name: 'api-worker-staging',
      script: 'dist/worker.js',
      exec_mode: 'fork', // worker 不监听端口，fork 即可
      instances: 1,
      env: {
        ...baseProcess.env,
        // worker 不需要 PORT
      },
      out_file: path.resolve(__dirname, 'logs/worker-out.log'),
      error_file: path.resolve(__dirname, 'logs/worker-error.log'),
    },
  ],
};
