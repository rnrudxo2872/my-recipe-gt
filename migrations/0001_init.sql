-- 레시퐁 초기 스키마

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  -- admin: 관리자, friend: 지인(한도 없음), member: 일반 가입자
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'friend', 'member')),
  -- limited: 과다 사용으로 한도 축소, blocked: 이용 차단
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'limited', 'blocked')),
  status_reason TEXT,
  signup_ip TEXT,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

-- 지인 초대 코드. 이 코드로 가입하거나 등록하면 friend가 된다.
CREATE TABLE invites (
  code TEXT PRIMARY KEY,
  note TEXT NOT NULL DEFAULT '',
  max_uses INTEGER NOT NULL DEFAULT 1,
  uses INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER,
  created_at INTEGER NOT NULL,
  expires_at INTEGER
);

CREATE TABLE recipes (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  -- RecipeContent JSON (현재 버전)
  content TEXT NOT NULL,
  image TEXT,
  source_type TEXT NOT NULL,
  source_url TEXT,
  source_key TEXT,
  favorite INTEGER NOT NULL DEFAULT 0,
  version_count INTEGER NOT NULL DEFAULT 1,
  -- 목록·냉장고 화면에서 content JSON을 풀지 않도록 따로 둔 요약
  time_minutes INTEGER,
  servings INTEGER,
  tags TEXT NOT NULL DEFAULT '[]',
  ingredient_names TEXT NOT NULL DEFAULT '',
  search_text TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_recipes_user ON recipes(user_id, updated_at DESC);
CREATE INDEX idx_recipes_user_source ON recipes(user_id, source_key);

-- 원본과 내가 바꾼 버전들. 첫 행이 원본이다.
CREATE TABLE recipe_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recipe_id TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_versions_recipe ON recipe_versions(recipe_id, id DESC);

-- 같은 영상·글은 한 번만 분석하도록 모든 사용자가 함께 쓰는 캐시
CREATE TABLE extraction_cache (
  source_key TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  image TEXT,
  source_url TEXT,
  method TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE pantry (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  items TEXT NOT NULL DEFAULT '[]',
  updated_at INTEGER NOT NULL
);

-- 하루 사용량. user_id 0은 전체 합계(kind별)
CREATE TABLE usage_daily (
  day TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, user_id, kind)
);

-- 짧은 구간 요청 횟수 제한(분당 AI 호출, 로그인 시도 등)
CREATE TABLE rate_buckets (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);

-- R2를 쓰지 않을 때 사진을 base64로 보관
CREATE TABLE images (
  key TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  mime TEXT NOT NULL,
  store TEXT NOT NULL DEFAULT 'd1',
  data TEXT,
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_images_user ON images(user_id);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- 관리자 화면에 보여 줄 사건 기록(자동 제한, 차단 등)
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  kind TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_events_created ON events(created_at DESC);
