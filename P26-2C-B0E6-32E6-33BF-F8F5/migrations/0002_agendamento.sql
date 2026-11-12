-- Agendamento de monitoria. Usuários ficam em discord_users (0001).
CREATE TABLE IF NOT EXISTS slots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  monitor_id TEXT NOT NULL REFERENCES discord_users(user_id),
  start_ts INTEGER NOT NULL,            -- epoch em ms (UTC)
  end_ts INTEGER NOT NULL,
  UNIQUE (monitor_id, start_ts),
  CHECK (end_ts > start_ts)
);

-- UNIQUE(slot_id): trava final contra reserva dupla.
CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slot_id INTEGER NOT NULL UNIQUE REFERENCES slots(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES discord_users(user_id),
  topic TEXT NOT NULL CHECK (length(topic) BETWEEN 3 AND 300),
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_slots_start ON slots(start_ts);
CREATE INDEX IF NOT EXISTS idx_bookings_student ON bookings(student_id);
