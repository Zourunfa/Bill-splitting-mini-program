# 一起去 Spring Boot 后端

这里是微信云开发 `ledger` 云函数的并行替代实现，使用 Java 17、Spring Boot 3、MySQL 8 和 MyBatis。小程序现有 `Trip` 与 `Command` JSON 契约保持不变；不配置 API 地址时，原云函数路径仍可使用。

## 本地运行

需要 JDK 17 和 Docker。项目带 Maven Wrapper，不必单独安装 Maven。首次启动前，在 `jiqian-server/.env` 填写微信 AppSecret；本机开发用的数据库密码和 JWT 密钥应保存在这个已忽略的文件里。

```bash
cd jiqian-server
cp .env.example .env
# 编辑 .env，填写 WECHAT_APP_SECRET
docker compose up -d mysql
./run-local.sh
```

首次启动会从 `src/main/resources/schema.sql` 创建缺失的表。`WECHAT_APP_ID` 已按项目 AppID 预填；`DB_PASSWORD`、`MYSQL_ROOT_PASSWORD` 和 `JWT_SECRET` 请用随机值。`run-local.sh` 会加载 `.env` 并启动后端。若本机访问微信接口需要代理，可在 `WECHAT_PROXY_HOST` 和 `WECHAT_PROXY_PORT` 设置代理；Docker Compose 中可单独用 `WECHAT_PROXY_HOST_DOCKER` 设置容器访问宿主机代理的地址。

也可以用 Docker 同时启动 API 和 MySQL：

```bash
docker compose up --build
```

`JWT_SECRET` 只能放在服务端。生产环境还需要设置 `DB_URL`、`DB_USER`、`DB_PASSWORD`，并用 HTTPS 域名访问服务。

小程序备案和服务端域名备案是两件事：服务部署在中国大陆时，API 域名仍需按要求完成 ICP 备案；公众平台还要把 HTTPS 域名加入小程序的 `request` 合法域名。

## API

除登录外，都需要 `Authorization: Bearer <JWT>`；身份只取自已签名 JWT，不接受客户端传入的 `openid`。

| Method | Path | 请求 | 返回 data |
| --- | --- | --- | --- |
| POST | `/api/auth/login` | `{ "code": "wx.login 返回值" }` | `{ token, user }` |
| GET | `/api/bootstrap` | — | `{ user, trips }` |
| POST | `/api/trips` | `{ requestId, name, input }` | `Trip` |
| POST | `/api/trips/join` | `{ inviteCode, name }` | `Trip` |
| POST | `/api/trips/{tripId}/commands` | 原有 `Command` | `Trip` |

所有结果都包装为 `{ ok, data }` 或 `{ ok: false, error }`。写入命令在 InnoDB 事务中锁定旅行行、运行规则、更新版本并保存子表；单笔金额仍以分存储，分摊由服务端计算。

## 从微信云数据库导入

1. 在云开发控制台分别导出 `users` 和 `trips` 集合，保留每笔账单及旅行成员等内嵌数据。
2. 确认 JSON 文件分别是文档数组，或对象中包含 `data`、`records`、`list` 数组。云开发 `invites` 集合不必导入，邀请码已存于旅行对象。
3. 先启动本机 MySQL，让应用创建表，再转换导出文件：

   ```bash
   node scripts/cloud-export-to-sql.mjs users.json trips.json /tmp/jiqian-migration.sql
   ```

4. 检查生成的 SQL 和记录数，再导入目标 MySQL：

   ```bash
   mysql --default-character-set=utf8mb4 --host=127.0.0.1 --user=jiqian --password jiqian < /tmp/jiqian-migration.sql
   ```

导入脚本保留旅行、成员、软删除账单、逐成员分摊、转账和最近 200 条审计记录。它以事务包裹导入，并可重复生成/执行；首次切换前仍应备份云数据库和 MySQL。

切换时先让用户暂停记账，导出并导入最后一份云数据库快照，再发布指向 Java API 的小程序版本。旧版小程序包仍可能继续调用云函数，切换窗口要安排使用者更新，或先部署能拦截旧版写入的方案；不能同时让新旧客户端分别写 MySQL 和云数据库，否则两边的数据会分叉。保留云数据库备份作为回退点；如果要切回云开发，需先把 Java 后端新增数据回迁。

## 小程序切换

在根目录 `.env.local` 设置：

```dotenv
TARO_APP_CLOUD_ENV=
TARO_APP_API_BASE_URL=https://api.example.com
```

设置 API 地址后，微信端优先请求 Java 后端并使用 `wx.login()` 换取 JWT；清空该地址且保留 `TARO_APP_CLOUD_ENV` 时仍走云函数，两个值都为空时使用本地演示。H5 始终保留演示模式。小程序 request 合法域名必须配置为 HTTPS API 域名，切换前先用体验版验证登录、加入邀请、账单、结算和并发操作。
