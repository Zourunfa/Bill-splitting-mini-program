import cloud from 'wx-server-sdk';
import { createHandler, type Database } from './handler';

// 微信云函数启动入口：选择当前部署环境，并把可信的调用者身份交给业务处理器。
// wx-server-sdk 4 的运行时支持该 symbol，但其声明文件仍把 env 限定为 string。
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV as unknown as string });
export const main = createHandler({
  db: cloud.database() as unknown as Database,
  // 身份只从微信调用上下文取得，忽略客户端传入的 userId / actorId。
  getUserId: () => cloud.getWXContext().OPENID
});
