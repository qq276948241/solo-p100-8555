# 考研自习室座位预约系统 — 架构说明

## 目录结构

```
project100/
├── backend/
│   ├── package.json        依赖声明 (express, better-sqlite3, jsonwebtoken, bcryptjs, cors)
│   ├── db.js               数据库层：建表、迁移、种子数据
│   ├── reservation.js      业务层：预约/签到全部逻辑
│   └── server.js           路由层：HTTP 接口，参数接收与响应
└── web/
    ├── vite.config.js      Vite 配置，开发代理 /api → localhost:3000
    ├── index.html
    └── src/
        ├── main.js         Vue 应用入口
        ├── App.vue         根组件
        ├── router.js       路由表 + 守卫
        ├── http.js         Axios 实例 + JWT 拦截器
        ├── index.css       全局样式
        ├── components/
        │   └── Layout.vue  顶部导航栏布局
        └── views/
            ├── Login.vue           登录页
            ├── Home.vue            座位预约主页
            ├── MyReservations.vue  我的预约 + 签到
            └── Admin.vue           后台管理（自习室/座位/签到查看）
```

---

## 后端三层架构

后端按职责分成三层，数据流自上而下：

```
┌──────────────────────────────────────────────────┐
│  server.js   — 路由层 (Controller)               │
│  接收 HTTP 请求，提取参数，调用 reservation.js，    │
│  返回 JSON。不包含任何业务判断逻辑。                │
├──────────────────────────────────────────────────┤
│  reservation.js  — 业务层 (Service)              │
│  所有预约/签到的业务规则：状态校验、时间窗口判断、    │
│  过期扫描、并发防护。直接调用 db.js 执行 SQL。       │
├──────────────────────────────────────────────────┤
│  db.js  — 数据层 (Database)                      │
│  SQLite 连接、建表 DDL、字段迁移、种子数据。        │
│  只导出 db 实例，不包含业务函数。                   │
└──────────────────────────────────────────────────┘
```

### server.js — 路由层

只做三件事：**取参数 → 调函数 → 回结果**。典型示例：

```js
app.post('/api/reservations/:id/checkin', auth, (req, res) => {
  const result = reservation.performCheckIn(req.params.id, req.user.id);
  if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
  res.json({ success: true, check_in_time: result.check_in_time });
});
```

还包含两个中间件：
- **`auth`** — 验证 JWT，将 `req.user` 设为 `{ id, username, role }`
- **`adminAuth`** — 在 auth 基础上额外校验 `role === 'admin'`

### reservation.js — 业务层

导出的函数按职责分为四类：

| 类别 | 函数 | 说明 |
|------|------|------|
| **常量** | `RESERVATION_STATUS` | 状态枚举 `{ ACTIVE, CHECKED_IN, NO_SHOW, CANCELLED }` |
| | `TIME_SLOTS` | 时段配置，含 `startHour/endHour/checkInBeforeMinutes` |
| | `MAX_DAILY_RESERVATIONS` | 每日预约上限 = 2 |
| **状态流转** | `markExpiredAsNoShow()` | 扫描 active 预约，过期→no_show |
| | `validateCheckIn()` | 签到前置校验（权限/状态/时间窗口） |
| | `performCheckIn()` | 完整签到流程（过期扫描+校验+更新） |
| **预约 CRUD** | `validateReservationCreate()` | 创建前校验（每日上限/时段重复/座位冲突） |
| | `createReservation()` | 创建预约 |
| | `cancelReservation()` | 取消预约（含时段开始后不可取消校验） |
| **查询** | `getUserReservations()` | 用户预约列表（附带过期扫描） |
| | `getTodayUserStats()` | 今日预约统计 `{ count, slots }` |
| | `getAdminReservations()` | 管理员签到查看（多表 JOIN） |
| | `getSeatsWithReservationStatus()` | 座位列表（带 reserved 标记） |

业务函数的返回值约定：
- 成功：`{ ok: true, ...业务数据 }`
- 失败：`{ ok: false, status: HTTP状态码, error: 错误描述 }`

### db.js — 数据层

职责纯粹：建表、迁移、种子数据。导出 better-sqlite3 实例供 reservation.js 使用。

关键设计：
- **WAL 模式**：`db.pragma('journal_mode = WAL')`，读写可并发，适合单进程多请求场景
- **字段迁移**：用 `try/catch` 包裹 `ALTER TABLE`，兼容已有数据库
- **种子数据**：首次启动时插入默认账号和自习室座位

---

## 数据库表结构

### users — 用户表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 自增主键 |
| username | TEXT UNIQUE | 登录名 |
| password | TEXT | bcrypt 哈希密码 |
| role | TEXT | 角色：`user` 或 `admin` |
| created_at | DATETIME | 注册时间 |

**`role` 字段的用法**：
- `user` — 普通用户，可预约/签到/查看自己的预约
- `admin` — 管理员，额外拥有：新增自习室/座位、停用座位、查看所有人签到情况

前端通过 `router.js` 路由守卫和 `Layout.vue` 导航栏控制 admin 页面的可见性；后端通过 `adminAuth` 中间件在接口层做权限拦截，双层防护。

### rooms — 自习室表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 自增主键 |
| name | TEXT | 自习室名称 |
| description | TEXT | 描述（可选） |

### seats — 座位表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 自增主键 |
| room_id | INTEGER FK | 所属自习室 |
| seat_number | TEXT | 显示名如 "1排3号" |
| zone | TEXT | 区域：`silent`(静音区) 或 `discussion`(讨论区) |
| row_num / col_num | INTEGER | 网格坐标，控制座位在页面上的排列位置 |
| active | INTEGER | 1=启用（用户可见），0=停用（用户不可见） |

**区域设计**：1-3 排为静音区（紫色），4-5 排为讨论区（绿色），前端通过 `zone` 字段区分样式。

### reservations — 预约表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 自增主键 |
| user_id | INTEGER FK | 预约用户 |
| seat_id | INTEGER FK | 预约座位 |
| date | TEXT | 预约日期，格式 `YYYY-MM-DD`（**本地日期**） |
| time_slot | TEXT | 时段：`morning` / `afternoon` / `evening` |
| status | TEXT | 状态：`active` → `checked_in` / `no_show` / `cancelled` |
| check_in_time | TEXT | 签到时间（ISO 字符串），未签到为 NULL |
| created_at | DATETIME | 创建时间 |

**唯一索引的设计意图**：

```sql
CREATE UNIQUE INDEX idx_unique_reservation
ON reservations(seat_id, date, time_slot)
WHERE status = 'active';
```

- 防止同一座位、同一天、同一时段被重复预约
- `WHERE status = 'active'` 部分索引：**已取消/已签到/未签到的记录不参与冲突检测**，座位可以被再次预约
- 这是 SQLite 的"部分索引"特性，只对 active 行生效，取消后座位自动释放

**状态流转图**：

```
                    ┌──────────────┐
          预约成功   │    active    │
         ──────────►│   (待签到)    │
                    └──────┬───────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
         时段内签到    过期未签到      用户取消
              │            │            │
              ▼            ▼            ▼
        ┌──────────┐ ┌──────────┐ ┌───────────┐
        │checked_in│ │ no_show  │ │ cancelled │
        │ (已签到)  │ │ (未签到)  │ │ (已取消)   │
        └──────────┘ └──────────┘ └───────────┘
```

---

## 前后端交互

### JWT 认证流程

```
1. 用户提交用户名密码 → POST /api/auth/login
2. 后端验证 bcrypt，签发 JWT（payload: { id, username, role }，有效期 7 天）
3. 前端收到 token 存入 localStorage，同时存 user 信息
4. 后续请求通过 Axios 拦截器自动附加 Authorization: Bearer <token>
5. 后端 auth 中间件验证 JWT，将解码结果挂到 req.user
6. Token 过期或无效 → 401 → 前端拦截器清除 localStorage 并跳转 /login
```

### 前端文件职责

| 文件 | 路由 | 职责 |
|------|------|------|
| **Login.vue** | `/login` | 登录表单，调用登录接口，存 token/user 到 localStorage |
| **Home.vue** | `/` | 座位预约主页：选自习室→选时段→看座位图→点座位→确认预约 |
| **MyReservations.vue** | `/my` | 我的预约列表：显示状态标签、签到按钮、取消按钮 |
| **Admin.vue** | `/admin` | 后台管理：新增/删除自习室、新增/停用/删除座位、查看签到情况 |

**路由守卫**（[router.js](file:///d:/code/ai-prompt/solo-chrome-dev-F12/repos/repo100/project100/web/src/router.js#L19-L32)）：
- `requiresAuth` — 无 token 跳转登录页
- `requiresAdmin` — 非 admin 角色跳转首页
- 已登录用户访问 `/login` 自动跳转首页

**Axios 封装**（[http.js](file:///d:/code/ai-prompt/solo-chrome-dev-F12/repos/repo100/project100/web/src/http.js)）：
- 请求拦截器：自动附加 `Authorization: Bearer <token>`
- 响应拦截器：自动解包 `res.data`；401 时清除本地状态并跳转登录
- baseURL 为 `/api`，开发时由 Vite 代理到后端 3000 端口

### API 接口一览

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| POST | `/api/auth/login` | 公开 | 登录，返回 JWT |
| GET | `/api/rooms` | 登录 | 自习室列表 |
| POST | `/api/rooms` | admin | 新增自习室 |
| DELETE | `/api/rooms/:id` | admin | 删除自习室（含其下座位） |
| GET | `/api/rooms/:roomId/seats?date=&timeSlot=` | 登录 | 座位列表（带 reserved 标记） |
| GET | `/api/admin/rooms/:roomId/seats` | admin | 座位列表（含停用的） |
| POST | `/api/seats` | admin | 新增座位 |
| PUT | `/api/seats/:id/toggle` | admin | 启用/停用座位 |
| DELETE | `/api/seats/:id` | admin | 删除座位 |
| GET | `/api/reservations/my` | 登录 | 我的预约列表 |
| GET | `/api/reservations/stats/today` | 登录 | 今日预约统计 |
| POST | `/api/reservations` | 登录 | 创建预约 |
| POST | `/api/reservations/:id/checkin` | 登录 | 签到 |
| DELETE | `/api/reservations/:id` | 登录 | 取消预约 |
| GET | `/api/admin/reservations?date=&room_id=` | admin | 签到情况查看 |

---

## 签到功能完整流程

以用户点击"📌 签到"按钮为例，完整的数据流：

```
┌─ 前端 ──────────────────────────────────────────────┐
│                                                       │
│  1. MyReservations.vue                                │
│     canCheckIn(r) 前端预判：                          │
│       now >= slotStart - 15min && now < slotEnd       │
│     满足条件才显示签到按钮                             │
│                                                       │
│  2. 用户点击签到 → checkIn(id)                        │
│     POST /api/reservations/:id/checkin                │
│     Headers: Authorization: Bearer <token>            │
│                                                       │
└──────────────────────────┬────────────────────────────┘
                           │
┌─ 后端 ───────────────────▼────────────────────────────┐
│                                                       │
│  3. server.js — auth 中间件                           │
│     验证 JWT → req.user = { id, username, role }      │
│                                                       │
│  4. server.js — 路由处理                              │
│     reservation.performCheckIn(req.params.id,         │
│                                req.user.id)            │
│                                                       │
│  5. reservation.js — performCheckIn()                 │
│     ├─ markExpiredAsNoShow()  扫描所有 active 预约     │
│     │   过期→no_show (UPDATE ... WHERE status='active')│
│     ├─ findReservationById()  查询该预约               │
│     ├─ validateCheckIn()      校验链：                 │
│     │   ├─ 预约存在？                                   │
│     │   ├─ 是自己的？                                   │
│     │   ├─ 状态不是 cancelled/checked_in/no_show？      │
│     │   ├─ now >= checkInOpen？(签到窗口已开放)          │
│     │   └─ now < slotEnd？(签到窗口未关闭)               │
│     │       └─ 若已过期：UPDATE status→no_show           │
│     └─ UPDATE reservations                            │
│         SET status='checked_in', check_in_time=now    │
│         WHERE id=? AND status='active'   ← 乐观锁      │
│         changes=0 → 返回"状态已变更"错误               │
│                                                       │
│  6. server.js — 返回响应                              │
│     成功: { success: true, check_in_time: "..." }     │
│     失败: { error: "错误原因" }                        │
│                                                       │
└─ 后端 ───────────────────────────────────────────────┘
                           │
┌─ 前端 ───────────────────▼────────────────────────────┐
│                                                       │
│  7. MyReservations.vue                                │
│     签到成功 → 重新加载预约列表                        │
│     状态标签从"待签到"变为"已签到"                     │
│     显示签到时间                                       │
│                                                       │
└───────────────────────────────────────────────────────┘
```

### 并发安全设计

所有 UPDATE 操作都带 `WHERE status = 'active'` 条件（乐观锁），确保：
- 两个请求同时签到同一预约 → 只有第一个 `changes=1`，第二个 `changes=0` 返回错误
- 签到和取消并发 → 取消先执行后签到会因 status 不匹配而失败
- 过期扫描和签到并发 → 两端都带状态条件，互不覆盖

---

## 部署注意事项

### 1. better-sqlite3 的 WAL 模式

[db.js](file:///d:/code/ai-prompt/solo-chrome-dev-F12/repos/repo100/project100/backend/db.js#L8) 中 `db.pragma('journal_mode = WAL')` 已开启。WAL 模式的优势：
- **读写并发**：读操作不阻塞写操作，适合单进程多并发请求
- **性能更好**：写操作先写 WAL 日志，批量合并到主库

注意：
- SQLite 是单文件数据库，`data.db` 会自动创建在 `backend/` 目录下
- WAL 模式会产生 `-wal` 和 `-shm` 伴随文件，**备份时三个文件要一起拷贝**
- 不支持多进程同时写入（单 Node 实例运行没问题）

### 2. 默认账号

| 角色 | 用户名 | 密码 |
|------|--------|------|
| 管理员 | admin | admin123 |
| 普通用户 | user1 | user123 |

密码使用 bcrypt 哈希存储，种子数据在 [db.js](file:///d:/code/ai-prompt/solo-chrome-dev-F12/repos/repo100/project100/backend/db.js#L67-L76) 中仅当用户不存在时插入。**部署后务必修改默认密码**。

### 3. JWT Secret

当前硬编码在 [server.js](file:///d:/code/ai-prompt/solo-chrome-dev-F12/repos/repo100/project100/backend/server.js#L10) 中：

```js
const JWT_SECRET = 'study-room-secret-key-2024';
```

生产环境应改为环境变量：`process.env.JWT_SECRET`，且使用强随机字符串。

### 4. 启动命令

```bash
# 后端
cd backend && npm install && node server.js    # 默认 3000 端口

# 前端（开发）
cd web && npm install && npm run dev           # 默认 5173 端口

# 前端（生产构建）
cd web && npm run build                        # 产物在 dist/ 目录
```

### 5. 日期与时区

系统中所有日期字符串均为**本地日期**（非 UTC）。前后端统一使用以下方式获取当天日期：

```js
const d = new Date();
const today = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
```

`getSlotTimeRange()` 将日期字符串解析为本地时间的 Date 对象，确保和 `new Date()` 比较时时区一致。部署时需确保服务器时区与用户时区一致，或改为按用户时区处理。
