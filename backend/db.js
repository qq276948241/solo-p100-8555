const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');

const dbPath = path.join(__dirname, 'data.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS rooms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS seats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id INTEGER NOT NULL,
    seat_number TEXT NOT NULL,
    zone TEXT NOT NULL DEFAULT 'silent',
    row_num INTEGER NOT NULL,
    col_num INTEGER NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (room_id) REFERENCES rooms(id)
  );

  CREATE TABLE IF NOT EXISTS reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    seat_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    time_slot TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    check_in_time TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (seat_id) REFERENCES seats(id)
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_reservation 
  ON reservations(seat_id, date, time_slot) 
  WHERE status = 'active';
`);

try {
  db.exec(`ALTER TABLE reservations ADD COLUMN check_in_time TEXT`);
} catch (e) {}


const adminPassword = bcrypt.hashSync('admin123', 10);
const userPassword = bcrypt.hashSync('user123', 10);

const checkAdmin = db.prepare('SELECT COUNT(*) as count FROM users WHERE username = ?');
if (checkAdmin.get('admin').count === 0) {
  db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)').run('admin', adminPassword, 'admin');
}
if (checkAdmin.get('user1').count === 0) {
  db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)').run('user1', userPassword, 'user');
}

const checkRoom = db.prepare('SELECT COUNT(*) as count FROM rooms');
if (checkRoom.get().count === 0) {
  const roomId = db.prepare('INSERT INTO rooms (name, description) VALUES (?, ?)').run('一号自习室', '考研专用自习室').lastInsertRowid;
  
  const insertSeat = db.prepare('INSERT INTO seats (room_id, seat_number, zone, row_num, col_num) VALUES (?, ?, ?, ?, ?)');
  for (let row = 1; row <= 5; row++) {
    for (let col = 1; col <= 6; col++) {
      const zone = row <= 3 ? 'silent' : 'discussion';
      insertSeat.run(roomId, `${row}排${col}号`, zone, row, col);
    }
  }
}

module.exports = db;
