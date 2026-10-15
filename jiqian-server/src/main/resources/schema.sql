-- Java 后端的关系型数据结构。金额字段以整数“分”存储；旅行子表通过 trip_id 归属账本。
CREATE TABLE IF NOT EXISTS users (
  id         VARCHAR(64)  NOT NULL PRIMARY KEY COMMENT '微信 openid',
  name       VARCHAR(20)  NOT NULL DEFAULT '旅友',
  created_at BIGINT       NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS trips (
  id          VARCHAR(64)  NOT NULL PRIMARY KEY,
  name        VARCHAR(30)  NOT NULL,
  destination VARCHAR(30)  NOT NULL,
  start_date  CHAR(10)     NOT NULL,
  end_date    CHAR(10)     NOT NULL,
  creator_id  VARCHAR(64)  NOT NULL,
  status      VARCHAR(10)  NOT NULL DEFAULT 'active',
  invite_code VARCHAR(64)  NOT NULL,
  version     INT          NOT NULL DEFAULT 1,
  created_at  BIGINT       NOT NULL,
  UNIQUE KEY uk_trips_invite_code (invite_code),
  KEY idx_trips_creator (creator_id),
  KEY idx_trips_created (created_at),
  CONSTRAINT fk_trips_creator FOREIGN KEY (creator_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS trip_members (
  trip_id       VARCHAR(64) NOT NULL,
  member_id     VARCHAR(64) NOT NULL,
  name          VARCHAR(20) NOT NULL,
  color         VARCHAR(10) NOT NULL,
  active        TINYINT(1)  NOT NULL DEFAULT 1,
  member_order  INT         NOT NULL,
  joined_at     BIGINT      NOT NULL,
  PRIMARY KEY (trip_id, member_id),
  KEY idx_trip_members_member (member_id, active, trip_id),
  CONSTRAINT fk_trip_members_trip FOREIGN KEY (trip_id) REFERENCES trips (id) ON DELETE CASCADE,
  CONSTRAINT fk_trip_members_user FOREIGN KEY (member_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS expenses (
  trip_id      VARCHAR(64)  NOT NULL,
  id           VARCHAR(100) NOT NULL COMMENT '客户端 requestId，在旅行范围内幂等',
  title        VARCHAR(60)  NOT NULL,
  amount       INT          NOT NULL COMMENT '单位：分',
  payer_id     VARCHAR(64)  NOT NULL,
  category     VARCHAR(10)  NOT NULL,
  expense_date CHAR(10)     NOT NULL,
  note         VARCHAR(200) NOT NULL DEFAULT '',
  creator_id   VARCHAR(64)  NOT NULL,
  deleted      TINYINT(1)   NOT NULL DEFAULT 0,
  created_at   BIGINT       NOT NULL,
  updated_at   BIGINT       NOT NULL,
  PRIMARY KEY (trip_id, id),
  KEY idx_expenses_trip_date (trip_id, expense_date, created_at),
  CONSTRAINT fk_expenses_trip FOREIGN KEY (trip_id) REFERENCES trips (id) ON DELETE CASCADE,
  CONSTRAINT fk_expenses_payer FOREIGN KEY (payer_id) REFERENCES users (id),
  CONSTRAINT fk_expenses_creator FOREIGN KEY (creator_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS expense_shares (
  trip_id          VARCHAR(64) NOT NULL,
  expense_id       VARCHAR(100) NOT NULL,
  member_id        VARCHAR(64) NOT NULL,
  amount           INT         NOT NULL COMMENT '分摊金额（分）',
  participant_order INT        NOT NULL COMMENT '保留客户端参与成员顺序',
  PRIMARY KEY (trip_id, expense_id, member_id),
  KEY idx_expense_shares_member (trip_id, member_id),
  CONSTRAINT fk_expense_shares_expense FOREIGN KEY (trip_id, expense_id) REFERENCES expenses (trip_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_expense_shares_user FOREIGN KEY (member_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS settlements (
  trip_id      VARCHAR(64) NOT NULL,
  id           VARCHAR(100) NOT NULL COMMENT '客户端 requestId，在旅行范围内幂等',
  from_id      VARCHAR(64) NOT NULL,
  to_id        VARCHAR(64) NOT NULL,
  amount       INT         NOT NULL,
  status       VARCHAR(10) NOT NULL DEFAULT 'pending',
  created_at   BIGINT      NOT NULL,
  confirmed_at BIGINT      NULL,
  PRIMARY KEY (trip_id, id),
  KEY idx_settlements_trip_status (trip_id, status),
  CONSTRAINT fk_settlements_trip FOREIGN KEY (trip_id) REFERENCES trips (id) ON DELETE CASCADE,
  CONSTRAINT fk_settlements_from FOREIGN KEY (from_id) REFERENCES users (id),
  CONSTRAINT fk_settlements_to FOREIGN KEY (to_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS audit_logs (
  id        BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
  trip_id   VARCHAR(64)  NOT NULL,
  actor_id  VARCHAR(64)  NOT NULL,
  action    VARCHAR(20)  NOT NULL,
  target_id VARCHAR(100) NOT NULL,
  at        BIGINT       NOT NULL,
  KEY idx_audit_trip_id (trip_id, id),
  CONSTRAINT fk_audit_trip FOREIGN KEY (trip_id) REFERENCES trips (id) ON DELETE CASCADE,
  CONSTRAINT fk_audit_actor FOREIGN KEY (actor_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
