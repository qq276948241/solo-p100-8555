const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('./db');

const app = express();
const PORT = 3000;
const JWT_SECRET = 'study-room-secret-key-2024';

app.use(cors());
app.use(express.json());

function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: '未登录' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'token无效' });
  }
}

function adminAuth(req, res, next) {
  auth(req, res, () => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: '无权限' });
    next();
  });
}

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }
  const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
});

app.get('/api/rooms', auth, (req, res) => {
  const rooms = db.prepare('SELECT * FROM rooms ORDER BY id').all();
  res.json(rooms);
});

app.post('/api/rooms', adminAuth, (req, res) => {
  const { name, description } = req.body;
  const result = db.prepare('INSERT INTO rooms (name, description) VALUES (?, ?)').run(name, description || '');
  res.json({ id: result.lastInsertRowid, name, description });
});

app.delete('/api/rooms/:id', adminAuth, (req, res) => {
  db.prepare('DELETE FROM seats WHERE room_id = ?').run(req.params.id);
  db.prepare('DELETE FROM rooms WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

app.get('/api/rooms/:roomId/seats', auth, (req, res) => {
  const { date, timeSlot } = req.query;
  const seats = db.prepare('SELECT * FROM seats WHERE room_id = ? AND active = 1 ORDER BY row_num, col_num').all(req.params.roomId);
  
  const reservations = db.prepare(`
    SELECT seat_id FROM reservations 
    WHERE date = ? AND time_slot = ? AND status = 'active'
  `).all(date, timeSlot);
  
  const reservedIds = new Set(reservations.map(r => r.seat_id));
  
  const result = seats.map(seat => ({
    ...seat,
    reserved: reservedIds.has(seat.id)
  }));
  
  res.json(result);
});

app.get('/api/admin/rooms/:roomId/seats', adminAuth, (req, res) => {
  const seats = db.prepare('SELECT * FROM seats WHERE room_id = ? ORDER BY row_num, col_num').all(req.params.roomId);
  res.json(seats);
});

app.post('/api/seats', adminAuth, (req, res) => {
  const { room_id, seat_number, zone, row_num, col_num } = req.body;
  const result = db.prepare('INSERT INTO seats (room_id, seat_number, zone, row_num, col_num) VALUES (?, ?, ?, ?, ?)')
    .run(room_id, seat_number, zone, row_num, col_num);
  res.json({ id: result.lastInsertRowid, ...req.body, active: 1 });
});

app.put('/api/seats/:id/toggle', adminAuth, (req, res) => {
  const seat = db.prepare('SELECT * FROM seats WHERE id = ?').get(req.params.id);
  const newActive = seat.active ? 0 : 1;
  db.prepare('UPDATE seats SET active = ? WHERE id = ?').run(newActive, req.params.id);
  res.json({ id: seat.id, active: newActive });
});

app.delete('/api/seats/:id', adminAuth, (req, res) => {
  db.prepare('DELETE FROM seats WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

function markNoShows() {
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const currentHour = now.getHours();

  const slotEndHours = { morning: 12, afternoon: 17, evening: 22 };

  const activeReservations = db.prepare(`
    SELECT id, date, time_slot FROM reservations WHERE status = 'active'
  `).all();

  const updateStmt = db.prepare("UPDATE reservations SET status = 'no_show' WHERE id = ?");

  for (const r of activeReservations) {
    if (r.date < today) {
      updateStmt.run(r.id);
    } else if (r.date === today) {
      const endHour = slotEndHours[r.time_slot];
      if (endHour !== undefined && currentHour >= endHour) {
        updateStmt.run(r.id);
      }
    }
  }
}

function getSlotTimeRange(timeSlot, date) {
  const ranges = {
    morning: { startHour: 7, startMin: 45, endHour: 12, endMin: 0 },
    afternoon: { startHour: 12, startMin: 45, endHour: 17, endMin: 0 },
    evening: { startHour: 17, startMin: 45, endHour: 22, endMin: 0 }
  };
  const range = ranges[timeSlot];
  if (!range) return null;
  const [y, m, d] = date.split('-').map(Number);
  const start = new Date(y, m - 1, d, range.startHour, range.startMin);
  const end = new Date(y, m - 1, d, range.endHour, range.endMin);
  return { start, end };
}

app.get('/api/reservations/my', auth, (req, res) => {
  markNoShows();
  const reservations = db.prepare(`
    SELECT r.*, s.seat_number, s.zone, rm.name as room_name
    FROM reservations r
    JOIN seats s ON r.seat_id = s.id
    JOIN rooms rm ON s.room_id = rm.id
    WHERE r.user_id = ? AND r.status IN ('active', 'checked_in', 'no_show')
    ORDER BY r.date DESC, r.time_slot DESC
  `).all(req.user.id);
  res.json(reservations);
});

app.get('/api/reservations/stats/today', auth, (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const count = db.prepare(`
    SELECT COUNT(*) as count FROM reservations 
    WHERE user_id = ? AND date = ? AND status = 'active'
  `).get(req.user.id, today).count;
  
  const slots = db.prepare(`
    SELECT time_slot FROM reservations 
    WHERE user_id = ? AND date = ? AND status = 'active'
  `).all(req.user.id, today).map(r => r.time_slot);
  
  res.json({ count, slots });
});

app.post('/api/reservations', auth, (req, res) => {
  const { seat_id, date, time_slot } = req.body;
  const userId = req.user.id;
  
  const today = date || new Date().toISOString().split('T')[0];
  
  const stats = db.prepare(`
    SELECT COUNT(*) as count FROM reservations 
    WHERE user_id = ? AND date = ? AND status = 'active'
  `).get(userId, today);
  
  if (stats.count >= 2) {
    return res.status(400).json({ error: '每天最多预约2个时段' });
  }
  
  const slotCheck = db.prepare(`
    SELECT COUNT(*) as count FROM reservations 
    WHERE user_id = ? AND date = ? AND time_slot = ? AND status = 'active'
  `).get(userId, today, time_slot);
  
  if (slotCheck.count > 0) {
    return res.status(400).json({ error: '该时段已预约过' });
  }
  
  const seatCheck = db.prepare(`
    SELECT COUNT(*) as count FROM reservations 
    WHERE seat_id = ? AND date = ? AND time_slot = ? AND status = 'active'
  `).get(seat_id, today, time_slot);
  
  if (seatCheck.count > 0) {
    return res.status(400).json({ error: '该座位已被预约' });
  }
  
  try {
    const result = db.prepare('INSERT INTO reservations (user_id, seat_id, date, time_slot) VALUES (?, ?, ?, ?)')
      .run(userId, seat_id, today, time_slot);
    res.json({ id: result.lastInsertRowid, success: true });
  } catch (e) {
    res.status(400).json({ error: '预约失败' });
  }
});

app.post('/api/reservations/:id/checkin', auth, (req, res) => {
  const reservation = db.prepare('SELECT * FROM reservations WHERE id = ?').get(req.params.id);
  if (!reservation) return res.status(404).json({ error: '预约不存在' });
  if (reservation.user_id !== req.user.id) return res.status(403).json({ error: '只能签到自己的预约' });
  if (reservation.status === 'cancelled') return res.status(400).json({ error: '已取消的预约不能签到' });
  if (reservation.status === 'checked_in') return res.status(400).json({ error: '已经签到过了' });
  if (reservation.status === 'no_show') return res.status(400).json({ error: '已过预约时段，无法签到' });

  markNoShows();

  const refreshed = db.prepare('SELECT * FROM reservations WHERE id = ?').get(req.params.id);
  if (refreshed.status === 'no_show') return res.status(400).json({ error: '已过预约时段，无法签到' });

  const range = getSlotTimeRange(reservation.time_slot, reservation.date);
  if (!range) return res.status(400).json({ error: '无效时段' });

  const now = new Date();
  if (now < range.start) {
    return res.status(400).json({ error: '签到未开放，时段开始前15分钟可签到' });
  }
  if (now >= range.end) {
    db.prepare("UPDATE reservations SET status = 'no_show' WHERE id = ?").run(req.params.id);
    return res.status(400).json({ error: '已过预约时段，无法签到' });
  }

  const checkInTime = now.toISOString();
  db.prepare("UPDATE reservations SET status = 'checked_in', check_in_time = ? WHERE id = ?")
    .run(checkInTime, req.params.id);

  res.json({ success: true, check_in_time: checkInTime });
});

app.get('/api/admin/reservations', adminAuth, (req, res) => {
  markNoShows();
  const { date, room_id } = req.query;
  const targetDate = date || new Date().toISOString().split('T')[0];

  let query = `
    SELECT r.id, r.date, r.time_slot, r.status, r.check_in_time, r.created_at,
           u.username, s.seat_number, s.zone, rm.name as room_name
    FROM reservations r
    JOIN users u ON r.user_id = u.id
    JOIN seats s ON r.seat_id = s.id
    JOIN rooms rm ON s.room_id = rm.id
    WHERE r.date = ? AND r.status IN ('active', 'checked_in', 'no_show')
  `;
  const params = [targetDate];

  if (room_id) {
    query += ' AND s.room_id = ?';
    params.push(room_id);
  }

  query += ' ORDER BY r.time_slot, s.seat_number';

  const reservations = db.prepare(query).all(...params);
  res.json(reservations);
});

app.delete('/api/reservations/:id', auth, (req, res) => {
  const reservation = db.prepare('SELECT * FROM reservations WHERE id = ?').get(req.params.id);
  if (!reservation || reservation.user_id !== req.user.id) {
    return res.status(403).json({ error: '无权限' });
  }
  db.prepare("UPDATE reservations SET status = 'cancelled' WHERE id = ?").run(req.params.id);
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`后端服务运行在 http://localhost:${PORT}`);
});
