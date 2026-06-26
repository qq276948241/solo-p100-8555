const db = require('./db');

// #region debug-point init:debug-helper
const _dbg = (() => {
  const fs = require('fs');
  const path = require('path');
  const envPath = path.join(__dirname, '..', '.dbg', 'checkin-timing-bug.env');
  let DEBUG_SERVER_URL = 'http://127.0.0.1:7777/event';
  let DEBUG_SESSION_ID = 'checkin-timing-bug';
  try {
    const env = fs.readFileSync(envPath, 'utf8');
    DEBUG_SERVER_URL = env.match(/DEBUG_SERVER_URL=(.+)/)?.[1] || DEBUG_SERVER_URL;
    DEBUG_SESSION_ID = env.match(/DEBUG_SESSION_ID=(.+)/)?.[1] || DEBUG_SESSION_ID;
  } catch {}
  return (hypothesisId, location, msg, data = {}) => {
    const payload = { sessionId: DEBUG_SESSION_ID, runId: 'post', hypothesisId, location, msg: '[DEBUG] ' + msg, data, ts: Date.now() };
    require('http').request(DEBUG_SERVER_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' } }).end(JSON.stringify(payload));
  };
})();
// #endregion

const RESERVATION_STATUS = {
  ACTIVE: 'active',
  CHECKED_IN: 'checked_in',
  NO_SHOW: 'no_show',
  CANCELLED: 'cancelled'
};

const USER_VISIBLE_STATUSES = [
  RESERVATION_STATUS.ACTIVE,
  RESERVATION_STATUS.CHECKED_IN,
  RESERVATION_STATUS.NO_SHOW
];

const TIME_SLOTS = {
  morning: {
    label: '上午 (08:00-12:00)',
    startHour: 8,
    startMin: 0,
    endHour: 12,
    endMin: 0,
    checkInBeforeMinutes: 15
  },
  afternoon: {
    label: '下午 (13:00-17:00)',
    startHour: 13,
    startMin: 0,
    endHour: 17,
    endMin: 0,
    checkInBeforeMinutes: 15
  },
  evening: {
    label: '晚上 (18:00-22:00)',
    startHour: 18,
    startMin: 0,
    endHour: 22,
    endMin: 0,
    checkInBeforeMinutes: 15
  }
};

const MAX_DAILY_RESERVATIONS = 2;

function _parseDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return { y, m, d };
}

function getSlotTimeRange(timeSlot, dateStr) {
  const slot = TIME_SLOTS[timeSlot];
  if (!slot) return null;
  const { y, m, d } = _parseDate(dateStr);
  const checkInOpen = new Date(
    y, m - 1, d,
    slot.startHour, slot.startMin - slot.checkInBeforeMinutes
  );
  const slotStart = new Date(y, m - 1, d, slot.startHour, slot.startMin);
  const slotEnd = new Date(y, m - 1, d, slot.endHour, slot.endMin);
  // #region debug-point H1:slot-time-range
  _dbg('H1', 'reservation.js:getSlotTimeRange', 'slot time range parsed', {
    timeSlot,
    dateStr,
    checkInOpen_iso: checkInOpen.toISOString(),
    checkInOpen_local: checkInOpen.toString(),
    checkInOpen_ts: checkInOpen.getTime(),
    slotStart_iso: slotStart.toISOString(),
    slotStart_ts: slotStart.getTime(),
    slotEnd_iso: slotEnd.toISOString(),
    slotEnd_ts: slotEnd.getTime(),
    parsed: { y, m, d }
  });
  // #endregion
  return { checkInOpen, slotStart, slotEnd };
}

function getTodayDateStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const result = `${y}-${m}-${day}`;
  // #region debug-point H1:get-today-date
  _dbg('H1', 'reservation.js:getTodayDateStr', 'today date from local time', {
    result,
    nowLocal: new Date().toString(),
    nowISO: new Date().toISOString(),
    tzOffset: new Date().getTimezoneOffset(),
    isLocalDate: true
  });
  // #endregion
  return result;
}

function findReservationById(id) {
  return db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
}

function isReservationOwner(reservation, userId) {
  return reservation && reservation.user_id === userId;
}

function _hasSlotExpired(dateStr, timeSlot, now = new Date()) {
  const { slotEnd } = getSlotTimeRange(timeSlot, dateStr);
  return now >= slotEnd;
}

function markExpiredAsNoShow() {
  const now = new Date();
  const today = getTodayDateStr();

  // #region debug-point H3-H4:mark-expired-entry
  _dbg('H3', 'reservation.js:markExpiredAsNoShow', 'start expired check', {
    now_local: now.toString(),
    now_ts: now.getTime(),
    today,
    now_iso: now.toISOString()
  });
  // #endregion

  const activeList = db.prepare(`
    SELECT id, date, time_slot FROM reservations WHERE status = ?
  `).all(RESERVATION_STATUS.ACTIVE);

  const updateStmt = db.prepare(
    `UPDATE reservations SET status = ? WHERE id = ? AND status = ?`
  );

  for (const r of activeList) {
    const dateCmp = r.date < today;
    const slotExpired = _hasSlotExpired(r.date, r.time_slot, now);
    const isExpired = dateCmp || slotExpired;
    // #region debug-point H3-H4:mark-expired-each
    _dbg('H4', 'reservation.js:markExpiredAsNoShow', 'checking reservation', {
      reservationId: r.id,
      r_date: r.date,
      today,
      dateCmp_result: dateCmp,
      dateCmp_operator: 'r.date < today',
      time_slot: r.time_slot,
      slotExpired,
      isExpired,
      updateHasStatusCondition: true
    });
    // #endregion
    if (isExpired) {
      const updateResult = updateStmt.run(RESERVATION_STATUS.NO_SHOW, r.id, RESERVATION_STATUS.ACTIVE);
      // #region debug-point H3-H4:mark-expired-updated
      _dbg('H3', 'reservation.js:markExpiredAsNoShow', 'marked as no_show', {
        reservationId: r.id,
        changes: updateResult.changes
      });
      // #endregion
    }
  }
}

function validateCheckIn(reservation, userId, now = new Date()) {
  if (!reservation) {
    return { ok: false, status: 404, error: '预约不存在' };
  }
  if (!isReservationOwner(reservation, userId)) {
    return { ok: false, status: 403, error: '只能签到自己的预约' };
  }
  if (reservation.status === RESERVATION_STATUS.CANCELLED) {
    return { ok: false, status: 400, error: '已取消的预约不能签到' };
  }
  if (reservation.status === RESERVATION_STATUS.CHECKED_IN) {
    return { ok: false, status: 400, error: '已经签到过了' };
  }
  if (reservation.status === RESERVATION_STATUS.NO_SHOW) {
    return { ok: false, status: 400, error: '已过预约时段，无法签到' };
  }

  const range = getSlotTimeRange(reservation.time_slot, reservation.date);
  if (!range) {
    return { ok: false, status: 400, error: '无效时段' };
  }

  // #region debug-point H2:validate-checkin-timing
  _dbg('H2', 'reservation.js:validateCheckIn', 'timing check', {
    reservationId: reservation.id,
    now_local: now.toString(),
    now_ts: now.getTime(),
    checkInOpen_local: range.checkInOpen.toString(),
    checkInOpen_ts: range.checkInOpen.getTime(),
    slotEnd_local: range.slotEnd.toString(),
    slotEnd_ts: range.slotEnd.getTime(),
    cmp_before: now.getTime() < range.checkInOpen.getTime(),
    cmp_after: now.getTime() >= range.slotEnd.getTime(),
    date: reservation.date,
    time_slot: reservation.time_slot,
    status: reservation.status
  });
  // #endregion

  if (now < range.checkInOpen) {
    return {
      ok: false,
      status: 400,
      error: '签到未开放，时段开始前15分钟可签到'
    };
  }
  if (now >= range.slotEnd) {
    // #region debug-point H3:validate-checkin-expire-update
    _dbg('H3', 'reservation.js:validateCheckIn', 'updating expired to no_show', {
      reservationId: reservation.id,
      currentStatus: reservation.status,
      hasCondition: true
    });
    // #endregion
    const updateResult = db.prepare(
      `UPDATE reservations SET status = ? WHERE id = ? AND status = ?`
    ).run(RESERVATION_STATUS.NO_SHOW, reservation.id, RESERVATION_STATUS.ACTIVE);
    // #region debug-point H3:validate-checkin-expire-update-result
    _dbg('H3', 'reservation.js:validateCheckIn', 'update result', {
      reservationId: reservation.id,
      changes: updateResult.changes
    });
    // #endregion
    return { ok: false, status: 400, error: '已过预约时段，无法签到' };
  }

  return { ok: true };
}

function performCheckIn(reservationId, userId) {
  // #region debug-point H5:perform-checkin-entry
  _dbg('H5', 'reservation.js:performCheckIn', 'checkin started', {
    reservationId,
    userId
  });
  // #endregion

  markExpiredAsNoShow();

  let reservation = findReservationById(reservationId);
  // #region debug-point H5:after-first-query
  _dbg('H5', 'reservation.js:performCheckIn', 'after first query', {
    reservationId,
    status: reservation?.status,
    check_in_time: reservation?.check_in_time
  });
  // #endregion

  const freshCheck = validateCheckIn(reservation, userId);
  if (!freshCheck.ok) return freshCheck;

  const now = new Date();
  const secondCheck = validateCheckIn(reservation, userId, now);
  if (!secondCheck.ok) return secondCheck;

  const checkInTime = now.toISOString();
  // #region debug-point H5:perform-checkin-update
  _dbg('H5', 'reservation.js:performCheckIn', 'updating to checked_in', {
    reservationId,
    currentStatus: reservation.status,
    hasStatusCondition: true
  });
  // #endregion
  const updateResult = db.prepare(
    `UPDATE reservations SET status = ?, check_in_time = ? WHERE id = ? AND status = ?`
  ).run(RESERVATION_STATUS.CHECKED_IN, checkInTime, reservationId, RESERVATION_STATUS.ACTIVE);

  // #region debug-point H5:after-update
  _dbg('H5', 'reservation.js:performCheckIn', 'after update', {
    reservationId,
    changes: updateResult.changes,
    checkInTime,
    updateHasStatusCondition: true
  });
  // #endregion

  if (updateResult.changes === 0) {
    return { ok: false, status: 400, error: '签到失败，预约状态已变更' };
  }

  return { ok: true, check_in_time: checkInTime };
}

function validateReservationCreate(userId, seatId, dateStr, timeSlot) {
  const today = dateStr || getTodayDateStr();

  const dailyCount = db.prepare(`
    SELECT COUNT(*) as count FROM reservations
    WHERE user_id = ? AND date = ? AND status = ?
  `).get(userId, today, RESERVATION_STATUS.ACTIVE).count;

  if (dailyCount >= MAX_DAILY_RESERVATIONS) {
    return { ok: false, error: '每天最多预约2个时段' };
  }

  const sameSlotCount = db.prepare(`
    SELECT COUNT(*) as count FROM reservations
    WHERE user_id = ? AND date = ? AND time_slot = ? AND status = ?
  `).get(userId, today, timeSlot, RESERVATION_STATUS.ACTIVE).count;

  if (sameSlotCount > 0) {
    return { ok: false, error: '该时段已预约过' };
  }

  const seatTaken = db.prepare(`
    SELECT COUNT(*) as count FROM reservations
    WHERE seat_id = ? AND date = ? AND time_slot = ? AND status = ?
  `).get(seatId, today, timeSlot, RESERVATION_STATUS.ACTIVE).count;

  if (seatTaken > 0) {
    return { ok: false, error: '该座位已被预约' };
  }

  return { ok: true, date: today };
}

function createReservation(userId, seatId, dateStr, timeSlot) {
  const validation = validateReservationCreate(userId, seatId, dateStr, timeSlot);
  if (!validation.ok) return { ok: false, error: validation.error };

  try {
    const result = db.prepare(`
      INSERT INTO reservations (user_id, seat_id, date, time_slot)
      VALUES (?, ?, ?, ?)
    `).run(userId, seatId, validation.date, timeSlot);

    return { ok: true, id: result.lastInsertRowid };
  } catch (e) {
    return { ok: false, error: '预约失败' };
  }
}

function cancelReservation(reservationId, userId) {
  const reservation = findReservationById(reservationId);
  if (!reservation || !isReservationOwner(reservation, userId)) {
    return { ok: false, status: 403, error: '无权限' };
  }
  if (reservation.status !== RESERVATION_STATUS.ACTIVE) {
    return { ok: false, status: 400, error: '只能取消待签到的预约' };
  }

  const range = getSlotTimeRange(reservation.time_slot, reservation.date);
  if (range && new Date() >= range.slotStart) {
    return { ok: false, status: 400, error: '时段已开始，无法取消' };
  }

  const updateResult = db.prepare(
    `UPDATE reservations SET status = ? WHERE id = ? AND status = ?`
  ).run(RESERVATION_STATUS.CANCELLED, reservationId, RESERVATION_STATUS.ACTIVE);

  if (updateResult.changes === 0) {
    return { ok: false, status: 400, error: '取消失败，预约状态已变更' };
  }

  return { ok: true };
}

function getUserReservations(userId) {
  markExpiredAsNoShow();
  const placeholders = USER_VISIBLE_STATUSES.map(() => '?').join(',');
  return db.prepare(`
    SELECT r.*, s.seat_number, s.zone, rm.name as room_name
    FROM reservations r
    JOIN seats s ON r.seat_id = s.id
    JOIN rooms rm ON s.room_id = rm.id
    WHERE r.user_id = ? AND r.status IN (${placeholders})
    ORDER BY r.date DESC, r.time_slot DESC
  `).all(userId, ...USER_VISIBLE_STATUSES);
}

function getTodayUserStats(userId) {
  const today = getTodayDateStr();
  const count = db.prepare(`
    SELECT COUNT(*) as count FROM reservations
    WHERE user_id = ? AND date = ? AND status = ?
  `).get(userId, today, RESERVATION_STATUS.ACTIVE).count;

  const slots = db.prepare(`
    SELECT time_slot FROM reservations
    WHERE user_id = ? AND date = ? AND status = ?
  `).all(userId, today, RESERVATION_STATUS.ACTIVE).map(r => r.time_slot);

  return { count, slots };
}

function getAdminReservations(dateStr, roomId) {
  markExpiredAsNoShow();
  const targetDate = dateStr || getTodayDateStr();
  const placeholders = USER_VISIBLE_STATUSES.map(() => '?').join(',');

  let query = `
    SELECT r.id, r.date, r.time_slot, r.status, r.check_in_time, r.created_at,
           u.username, s.seat_number, s.zone, rm.name as room_name
    FROM reservations r
    JOIN users u ON r.user_id = u.id
    JOIN seats s ON r.seat_id = s.id
    JOIN rooms rm ON s.room_id = rm.id
    WHERE r.date = ? AND r.status IN (${placeholders})
  `;
  const params = [targetDate, ...USER_VISIBLE_STATUSES];

  if (roomId) {
    query += ' AND s.room_id = ?';
    params.push(roomId);
  }

  query += ' ORDER BY r.time_slot, s.seat_number';

  return db.prepare(query).all(...params);
}

function getSeatsWithReservationStatus(roomId, dateStr, timeSlot) {
  const seats = db.prepare(
    `SELECT * FROM seats WHERE room_id = ? AND active = 1 ORDER BY row_num, col_num`
  ).all(roomId);

  const reservedRows = db.prepare(`
    SELECT seat_id FROM reservations
    WHERE date = ? AND time_slot = ? AND status = ?
  `).all(dateStr, timeSlot, RESERVATION_STATUS.ACTIVE);

  const reservedIds = new Set(reservedRows.map(r => r.seat_id));

  return seats.map(seat => ({
    ...seat,
    reserved: reservedIds.has(seat.id)
  }));
}

module.exports = {
  RESERVATION_STATUS,
  USER_VISIBLE_STATUSES,
  TIME_SLOTS,
  MAX_DAILY_RESERVATIONS,

  getSlotTimeRange,
  getTodayDateStr,
  findReservationById,
  isReservationOwner,
  markExpiredAsNoShow,
  validateCheckIn,
  performCheckIn,
  validateReservationCreate,
  createReservation,
  cancelReservation,
  getUserReservations,
  getTodayUserStats,
  getAdminReservations,
  getSeatsWithReservationStatus
};
