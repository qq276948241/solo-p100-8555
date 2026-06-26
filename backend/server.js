const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('./db');
const reservation = require('./reservation');

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
  const seats = reservation.getSeatsWithReservationStatus(req.params.roomId, date, timeSlot);
  res.json(seats);
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

app.get('/api/reservations/my', auth, (req, res) => {
  const reservations = reservation.getUserReservations(req.user.id);
  res.json(reservations);
});

app.get('/api/reservations/stats/today', auth, (req, res) => {
  const stats = reservation.getTodayUserStats(req.user.id);
  res.json(stats);
});

app.post('/api/reservations', auth, (req, res) => {
  const { seat_id, date, time_slot } = req.body;
  const result = reservation.createReservation(req.user.id, seat_id, date, time_slot);
  if (!result.ok) {
    return res.status(400).json({ error: result.error });
  }
  res.json({ id: result.id, success: true });
});

app.post('/api/reservations/:id/checkin', auth, (req, res) => {
  const result = reservation.performCheckIn(req.params.id, req.user.id);
  if (!result.ok) {
    return res.status(result.status || 400).json({ error: result.error });
  }
  res.json({ success: true, check_in_time: result.check_in_time });
});

app.get('/api/admin/reservations', adminAuth, (req, res) => {
  const { date, room_id } = req.query;
  const reservations = reservation.getAdminReservations(date, room_id);
  res.json(reservations);
});

app.delete('/api/reservations/:id', auth, (req, res) => {
  const result = reservation.cancelReservation(req.params.id, req.user.id);
  if (!result.ok) {
    return res.status(result.status || 400).json({ error: result.error });
  }
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`后端服务运行在 http://localhost:${PORT}`);
});
