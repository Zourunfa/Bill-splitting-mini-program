# 后端迁移技术方案：微信云开发 → Spring Boot + MySQL + MyBatis

> 现状：后端 = 1 个微信云函数 `ledger` + 云数据库 3 个集合（users / trips / invites），
> 业务规则全部集中在 `shared/ledger.ts`（纯函数：createTrip / joinTrip / applyCommand），
> 存储模型 = 旅行聚合单文档 JSON + 事务整体替换 + version 乐观锁。

---

## 一、总体架构

```
微信小程序 (Taro)                     后端服务
┌─────────────────┐   HTTPS/JWT    ┌──────────────────────────┐
│ src/services/   │ ─────────────▶ │ Spring Boot 3 + JDK 17   │
│ ledger.ts       │  Taro.request  │  ├─ Controller 层 (REST)  │
│ (仅改这一层)     │ ◀───────────── │  ├─ Service 层 (账本规则)  │
└─────────────────┘   { ok, data } │  ├─ MyBatis Mapper 层     │
                                   │  └─ MySQL 8.x             │
        微信登录 code ────────────▶ │  code2session → openid    │
                                   └──────────────────────────┘
```

**核心决策：保持「命令模式」不变。** 前端仍然发送 `Command`（addExpense/deleteExpense/...），
服务端在 Java 中原样移植 `applyCommand` 的规则校验。这样前端 95% 代码零改动，只需替换 `services/ledger.ts` 的网络层。

---

## 二、数据库设计（MySQL 8，InnoDB，utf8mb4）

推荐**关系建模**（替代单文档 JSON），查询和扩展性更好：

```sql
-- 用户表（微信用户）
CREATE TABLE users (
  id           VARCHAR(64)  PRIMARY KEY COMMENT 'openid',
  name         VARCHAR(20)  NOT NULL DEFAULT '旅友',
  created_at   BIGINT       NOT NULL
);

-- 旅行表
CREATE TABLE trips (
  id           VARCHAR(64)  PRIMARY KEY COMMENT 't_ + sha256(userId:requestId) 前32位',
  name         VARCHAR(30)  NOT NULL,
  destination  VARCHAR(30)  NOT NULL,
  start_date   CHAR(10)     NOT NULL,
  end_date     CHAR(10)     NOT NULL,
  creator_id   VARCHAR(64)  NOT NULL,
  status       VARCHAR(10)  NOT NULL DEFAULT 'active' COMMENT 'active/closed',
  invite_code  VARCHAR(64)  NOT NULL UNIQUE,
  version      INT          NOT NULL DEFAULT 1 COMMENT '乐观锁',
  created_at   BIGINT       NOT NULL,
  INDEX idx_creator (creator_id)
);

-- 旅行成员表（替代 members 数组 + memberIds 数组）
CREATE TABLE trip_members (
  trip_id   VARCHAR(64) NOT NULL,
  member_id VARCHAR(64) NOT NULL,
  name      VARCHAR(20) NOT NULL COMMENT '旅行内昵称',
  color     VARCHAR(10) NOT NULL,
  active    TINYINT(1)  NOT NULL DEFAULT 1,
  joined_at BIGINT      NOT NULL,
  PRIMARY KEY (trip_id, member_id)
);

-- 账单表
CREATE TABLE expenses (
  id          VARCHAR(64)  PRIMARY KEY COMMENT '客户端 requestId，天然幂等',
  trip_id     VARCHAR(64)  NOT NULL,
  title       VARCHAR(60)  NOT NULL,
  amount      INT          NOT NULL COMMENT '单位：分',
  payer_id    VARCHAR(64)  NOT NULL,
  category    VARCHAR(10)  NOT NULL,
  expense_date CHAR(10)    NOT NULL,
  note        VARCHAR(200) NOT NULL DEFAULT '',
  creator_id  VARCHAR(64)  NOT NULL,
  deleted     TINYINT(1)   NOT NULL DEFAULT 0,
  created_at  BIGINT       NOT NULL,
  updated_at  BIGINT       NOT NULL,
  INDEX idx_trip (trip_id, deleted)
);

-- 账单分摊表（替代 shares JSON）
CREATE TABLE expense_shares (
  expense_id VARCHAR(64) NOT NULL,
  member_id  VARCHAR(64) NOT NULL,
  amount     INT         NOT NULL COMMENT '分摊金额（分）',
  PRIMARY KEY (expense_id, member_id)
);

-- 结算转账表
CREATE TABLE settlements (
  id           VARCHAR(64) PRIMARY KEY,
  trip_id      VARCHAR(64) NOT NULL,
  from_id      VARCHAR(64) NOT NULL,
  to_id        VARCHAR(64) NOT NULL,
  amount       INT         NOT NULL,
  status       VARCHAR(10) NOT NULL DEFAULT 'pending' COMMENT 'pending/confirmed/cancelled',
  created_at   BIGINT      NOT NULL,
  confirmed_at BIGINT      NULL,
  INDEX idx_trip (trip_id, status)
);

-- 操作审计表（保留最近 200 条/旅行，可用定时任务裁剪）
CREATE TABLE audit_logs (
  id        BIGINT AUTO_INCREMENT PRIMARY KEY,
  trip_id   VARCHAR(64) NOT NULL,
  actor_id  VARCHAR(64) NOT NULL,
  action    VARCHAR(20) NOT NULL,
  target_id VARCHAR(64) NOT NULL,
  at        BIGINT      NOT NULL,
  INDEX idx_trip (trip_id, id)
);
```

> 简化替代方案：`trips` 表加一个 `data MEDIUMTEXT` 列直接存聚合 JSON（对应现状单文档模型），
> 迁移工作量减半，但失去 SQL 查询能力。第一版想快速上线可选这个，后续再拆表。

---

## 三、API 设计（与云函数 4 个 action 一一对应）

统一响应包装与现状一致：`{ ok: boolean, data?: T, error?: string }`

| 方法 | 路径 | 对应云函数 action | 说明 |
|---|---|---|---|
| POST | `/api/auth/login` | （新增） | body: `{ code }` → code2session → 返回 JWT + user |
| GET | `/api/bootstrap` | `bootstrap` | 当前用户 + 我参与的旅行列表（≤20，按创建时间倒序） |
| POST | `/api/trips` | `create` | body: `{ requestId, name, input }`，幂等创建 |
| POST | `/api/trips/join` | `join` | body: `{ inviteCode, name }` |
| POST | `/api/trips/{tripId}/commands` | `command` | body: `Command`（addExpense/editExpense/deleteExpense/recordTransfer/confirmTransfer/cancelTransfer/close/reopen/deactivateMember/renameSelf） |

鉴权：除 `/api/auth/login` 外全部需要 `Authorization: Bearer <JWT>`，从 JWT 解析 openid 替代云函数的 `getUserId()`。

---

## 四、认证方案（替代云函数自动登录）

```
小程序 wx.login() → 临时 code
   → POST /api/auth/login { code }
   → 后端调微信接口 code2session(appid, secret, code) 换取 openid + session_key
   → users 表 upsert
   → 签发 JWT（HS256，payload = openid，有效期 7~30 天）
   → 前端 Taro.setStorageSync 保存，之后每个请求带 Authorization
```

要点：
- AppSecret 只存服务端配置文件/环境变量，绝不能进小程序代码
- JWT 密钥用环境变量注入
- code2session 走微信服务端 API：`https://api.weixin.qq.com/sns/jscode2session`（后端服务器出口 IP 需在公众平台配置白名单视情况）

---

## 五、核心业务逻辑移植清单（ledger.ts → Java）

`shared/ledger.ts` 约 250 行，全部规则需在 Java `LedgerService` 中逐条复刻：

**校验函数**
- `text()` 长度校验（昵称≤20、用途≤60、旅行名≤30、目的地≤30、备注≤200）
- `validAmount()` 正整数分、≤100万；`validDate()` yyyy-MM-dd 且真实存在
- `validId()` `[a-zA-Z0-9_-]{1,100}`
- `equalShares()` 均分 + 尾差按成员 ID 排序固定分配（**分摊总额必须严格等于原金额**）

**命令规则（applyCommand 的 10 个分支）**
- 全局：操作者必须是该旅行 active 成员；账本 closed 后仅 reopen/幂等重试可用
- 幂等：`addExpense`/`recordTransfer` 用 requestId 查重，重复提交返回原结果
- `editExpense`/`deleteExpense`：expectedVersion 乐观锁校验；有待确认转账时禁止；仅记录人或创建者可操作
- `recordTransfer`：金额 ≤ min(付款方欠款, 收款方待收)
- `close`：仅创建者；全部结清且无 pending 转账
- `deactivateMember`：仅创建者；成员余额为 0 且无 pending 转账
- 事务尾部校验：退出成员的历史余额不得被改动（`getBalances` 全量校验）
- 每次成功操作：version + 1，写审计日志

**并发控制**：每个命令在 `@Transactional` 内执行，更新 trips 时带
`WHERE version = #{expectedVersion}`（或 `SELECT ... FOR UPDATE`），替代云数据库事务。

> 测试红利：`tests/ledger.test.ts` 是现成的规则说明书，移植时用 Java 重写一遍测试用例（JUnit 5），
> 全部通过即代表规则移植正确。

---

## 六、后端工程结构

```
jiqian-server/
├── pom.xml                          # Spring Boot 3.x, mybatis-spring-boot-starter, jjwt
├── src/main/java/com/jiqian/
│   ├── JiqianApplication.java
│   ├── controller/                  # AuthController / TripController / CommandController
│   ├── service/
│   │   ├── LedgerService.java       # applyCommand 移植（核心）
│   │   ├── BalanceCalculator.java   # getBalances / suggestTransfers 移植
│   │   └── WeChatAuthService.java   # code2session
│   ├── mapper/                      # MyBatis Mapper 接口 + XML
│   ├── domain/                      # Trip/Member/Expense/Settlement/Command（密封类或子类）
│   ├── common/
│   │   ├── ApiResponse.java         # { ok, data, error }
│   │   ├── BizException.java        # 业务异常 → error 文案（与现有提示语一致）
│   │   └── GlobalExceptionHandler.java
│   └── config/                      # JWT 拦截器、CORS 关闭（小程序不需要）
└── src/main/resources/
    ├── application.yml              # 数据源、微信 appid/secret（走环境变量）
    └── mapper/*.xml
```

---

## 七、前端改动点（最小化）

只改 `src/services/ledger.ts` 一个文件的 `call()` 实现：

```ts
// 原来：Taro.cloud.callFunction({ name: 'ledger', data: { action, ...payload } })
// 改为：Taro.request({ url: BASE_URL + path, header: { Authorization }, ... })
```

- 增加登录流程：App 启动时检查本地 token，无则 `wx.login()` → `/api/auth/login`
- `bootstrap/create/join/command` 四个方法签名保持不变，上层页面零改动
- 本地演示模式（isDemo 分支）完全保留，不受影响

---

## 八、部署与合规（小程序特有要求）

| 事项 | 说明 |
|---|---|
| 域名 + HTTPS | 小程序 `request` 强制 HTTPS，需购买域名 + SSL 证书（可用免费证书） |
| ICP 备案 | 服务器在国内则域名必须 ICP 备案（你小程序备案已在做，域名备案是另一件事） |
| 合法域名配置 | 公众平台 → 开发管理 → 服务器域名 → request 合法域名加入 `https://api.你的域名` |
| 部署 | 云服务器（轻量应用服务器即可）+ Nginx 反代 + `java -jar`，或 Docker |
| 数据迁移 | 现网如有数据：从云数据库导出 trips/users JSON → 写一次性脚本拆表导入 MySQL |

---

## 九、工作量估算

| 阶段 | 内容 | 预估 |
|---|---|---|
| 1 | Spring Boot 工程搭建 + MySQL 建表 + MyBatis Mapper | 0.5 ~ 1 天 |
| 2 | 微信登录（code2session + JWT） | 0.5 天 |
| 3 | **ledger.ts → Java 移植（核心，含 10 个命令分支）** | 2 ~ 3 天 |
| 4 | JUnit 复刻现有测试用例并跑通 | 1 天 |
| 5 | 前端网络层改造 + 联调 | 0.5 ~ 1 天 |
| 6 | 域名/备案/HTTPS/部署上线 | 1 ~ 3 天（备案时间另计，可能 1~2 周） |
| **合计** | | **约 1 周开发 + 备案等待** |

---

## 十、建议

1. **如果目的只是学习 Java 技术栈**：直接按本方案做，命令模式移植是很好的练习素材
2. **如果目的是降低云服务费用/自主可控**：值得做，MySQL 自己掌控
3. **如果小程序还没上线**：建议先用云开发版本上线跑通审核流程（已在进行中），
   Java 后端作为 v2 并行开发，避免阻塞当前发布节奏——两套后端对前端是透明的
   （都走 `services/ledger.ts` 抽象层），可以随时切换
