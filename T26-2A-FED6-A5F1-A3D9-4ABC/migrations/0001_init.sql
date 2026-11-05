-- Esquema Inicial Cloudflare D1 para T26-2A-FED6-A5F1-A3D9-4ABC (Projeto #0)
CREATE TABLE IF NOT EXISTS discord_users (
  user_id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  avatar TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS project_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  username TEXT NOT NULL,
  chave_projeto TEXT NOT NULL,
  conteudo TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_project_records_user ON project_records(user_id);
