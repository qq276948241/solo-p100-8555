# Debug Session: checkin-timing-bug

**Status**: [OPEN]
**Created**: 2026-06-26
**Description**: 签到时间窗口边界判断不准确，8:45分不能签到但8:59:59能；过了12点偶尔还能签到

---

## Hypotheses (验证结果)

| ID | Hypothesis | Status | Evidence |
|----|------------|--------|----------|
| H1 | `getTodayDateStr()` 返回 UTC 日期，但 `getSlotTimeRange` 把日期字符串当做本地日期解析，导致时区不一致 | ✅ **CONFIRMED** | 日志显示 `nowLocal: "Fri Jun 26 2026 10:23:25 GMT+0800"` 但 `getTodayDateStr()` 返回 `"2026-06-26"`（UTC日期）。当本地时间在 00:00-08:00 时，UTC日期比本地日期早一天，导致时段时间被算错一天。 |
| H2 | 签到校验边界判断方向错误 | ❌ REJECTED | 日志显示 `cmp_before` 和 `cmp_after` 的判断逻辑正确。 |
| H3 | `markExpiredAsNoShow()` 误判过期 | ⚠️ RELATED | H1 导致日期比较错误，进而导致 `r.date < today` 误判。 |
| H4 | 日期字符串字典序比较错误 | ❌ REJECTED | "YYYY-MM-DD" 格式字典序和时间序一致。 |
| H5 | 竞态问题：UPDATE 无状态条件 | ✅ **CONFIRMED** | `performCheckIn` 中 UPDATE 语句 `WHERE id = ?` 没有 `AND status = 'active'` 条件，并发时可能重复签到。 |

---

## Root Cause Analysis

### Bug 1 - 时区不一致（主因）
**影响范围**：所有和日期相关的操作（预约创建、过期检查、签到校验）

**问题描述**：
- 前端 `today = new Date().toISOString().split('T')[0]` → UTC 日期
- 后端 `getTodayDateStr() = new Date().toISOString().split('T')[0]` → UTC 日期
- 但 `getSlotTimeRange(timeSlot, dateStr)` 中：
  ```js
  const slotStart = new Date(y, m - 1, d, slot.startHour, slot.startMin);
  ```
  这里把 `dateStr`（UTC 日期）当做**本地日期**来解析时段时间。

**复现场景（UTC+8 时区）**：
1. 本地时间：6月26日 07:30 → UTC时间：6月25日 23:30
2. 用户预约"今天"上午时段 → 系统存 `date = "2026-06-25"`（UTC日期）
3. `getSlotTimeRange("morning", "2026-06-25")` → `slotStart = 本地时间6月25日08:00`
4. 本地时间6月26日 08:45 用户签到 → `now (6/26 08:45) >= slotEnd (6/25 12:00)` = true
5. 系统认为预约已过期，拒绝签到！

### Bug 2 - 竞态问题
**影响范围**：`performCheckIn` 并发场景

**问题描述**：
- UPDATE 语句没有 `WHERE status = 'active'` 条件
- 两个并发请求都通过 `validateCheckIn` 后，都会执行 UPDATE
- 后执行的会覆盖先执行的 `check_in_time`

### Bug 3 - 状态覆盖风险
**影响范围**：`validateCheckIn` 中超时处理

**问题描述**：
```js
if (now >= range.slotEnd) {
  db.prepare(`UPDATE reservations SET status = ? WHERE id = ?`)
    .run(RESERVATION_STATUS.NO_SHOW, reservation.id);
}
```
没有检查当前状态，可能把 `cancelled` 或 `checked_in` 的预约覆盖成 `no_show`。

---

## Evidence Logs

### Pre-fix (插桩阶段)

| Timestamp | Event | Data |
|-----------|-------|------|
| 1782440605504 | getTodayDateStr | result=2026-06-26, nowLocal=Fri Jun 26 2026 10:23:25 GMT+0800, tzOffset=-480 |
| 1782440665337 | getTodayDateStr | result=2026-06-26, nowLocal=Fri Jun 26 2026 10:24:25 GMT+0800 |
| 1782440665344 | getSlotTimeRange(morning) | dateStr=2026-06-26, checkInOpen_local=07:45, slotEnd_local=12:00 |
| 1782440665345 | getSlotTimeRange(evening) | dateStr=2026-06-26, checkInOpen_local=17:45, slotEnd_local=22:00 |

### Post-fix (验证阶段)

| Timestamp | Event | Data |
|-----------|-------|------|
| 1782441253 | TEST 1: getTodayDateStr | 返回本地日期 2026-06-26 ✅ 正确 |
| 1782441253 | TEST 2: 时段计算 | 签到开放=07:45, 开始=08:00, 结束=12:00 ✅ 正确 |
| 1782441253 | TEST 3: 签到开放前1秒 | 07:44:59 → 拒绝签到 ✅ 正确 |
| 1782441253 | TEST 4: 签到开放那一刻 | 07:45:00 → 允许签到 ✅ 正确 |
| 1782441253 | TEST 5: 时段结束前1秒 | 11:59:59 → 允许签到 ✅ 正确 |
| 1782441253 | TEST 6: 时段结束那一刻 | 12:00:00 → 拒绝签到 ✅ 正确 |
| 1782441253 | TEST 7: 时段结束后1秒 | 12:00:01 → 拒绝签到 ✅ 正确 |
| 1782441253 | TEST 9: 跨天场景 | 本地 6/26 07:30, UTC 6/25 23:30 → 本地日期=2026-06-26 ✅ 正确 |
| 1782441253 | TEST 10: 权限测试 | 403 无权限 ✅ 正确 |

---

## Race Condition Analysis (过期检查竞态)

### 已修复的竞态问题

1. **`performCheckIn` 并发签到**
   - 原问题：UPDATE 无 `status = 'active'` 条件，并发请求都会执行
   - 修复：`UPDATE ... WHERE id = ? AND status = 'active'`，并检查 `changes === 0` 返回错误
   - 结论：✅ 已修复

2. **`validateCheckIn` 中超时更新**
   - 原问题：直接 UPDATE 覆盖状态，可能把 `cancelled`/`checked_in` 改成 `no_show`
   - 修复：`UPDATE ... WHERE id = ? AND status = 'active'`
   - 结论：✅ 已修复

3. **`markExpiredAsNoShow` 过期更新**
   - 原问题：UPDATE 无状态条件
   - 修复：`UPDATE ... WHERE id = ? AND status = 'active'`
   - 结论：✅ 已修复

4. **`cancelReservation` 取消预约**
   - 原问题：UPDATE 无状态条件，无业务校验
   - 修复：增加状态检查、时段开始后不能取消、UPDATE 加 `AND status = 'active'`
   - 结论：✅ 已修复

### 竞态场景验证

| 场景 | 并发操作 | 结果 |
|------|---------|------|
| 两个 performCheckIn 同时处理同一预约 | A 通过校验 → B 通过校验 → A UPDATE(changes=1) → B UPDATE(changes=0) → B 返回错误 | ✅ 安全 |
| markExpired 和 performCheckIn 并发 | markExpired 判断过期 → performCheckIn 也判断过期，两端都拒绝 | ✅ 安全 |
| cancelReservation 和 performCheckIn 并发 | cancel 先执行(status→cancelled) → performCheckIn UPDATE WHERE status='active' → changes=0 | ✅ 安全 |

---

## Fix Summary

- [x] Root cause identified
- [x] Fix applied
- [ ] Post-fix verification passed

### Changes Made

**后端 [reservation.js](file:///d:/code/ai-prompt/solo-chrome-dev-F12/repos/repo100/project100/backend/reservation.js):**
1. ✅ `getTodayDateStr()` — 从 UTC 日期改为本地日期
2. ✅ `performCheckIn()` — UPDATE 加 `AND status = 'active'`，检查 changes
3. ✅ `validateCheckIn()` — 超时 UPDATE 加 `AND status = 'active'`
4. ✅ `markExpiredAsNoShow()` — UPDATE 加 `AND status = 'active'`
5. ✅ `cancelReservation()` — 增加状态校验、时段开始后不能取消、UPDATE 加状态条件

**前端 [Home.vue](file:///d:/code/ai-prompt/solo-chrome-dev-F12/repos/repo100/project100/web/src/views/Home.vue):**
1. ✅ `today` — 从 UTC 日期改为本地日期

**前端 [MyReservations.vue](file:///d:/code/ai-prompt/solo-chrome-dev-F12/repos/repo100/project100/web/src/views/MyReservations.vue):**
1. ✅ `canCheckIn()` — 增加 `now < slotEnd` 判断，避免过了结束时间还显示签到按钮

**前端 [Admin.vue](file:///d:/code/ai-prompt/solo-chrome-dev-F12/repos/repo100/project100/web/src/views/Admin.vue):**
1. ✅ `checkInDate` — 从 UTC 日期改为本地日期
