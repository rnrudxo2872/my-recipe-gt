-- 냉장고 여러 개와 재료 재고(양), 식단표.

CREATE TABLE fridges (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'fridge',
  position INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_fridges_user ON fridges (user_id, position);

CREATE TABLE fridge_items (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  fridge_id TEXT NOT NULL,
  name TEXT NOT NULL,
  -- 남은 양. 모르면 NULL(있기만 하다고 본다)
  qty REAL,
  unit TEXT NOT NULL DEFAULT '',
  added_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_fridge_items_user ON fridge_items (user_id, fridge_id);

CREATE TABLE meal_plans (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- 'YYYY-MM-DD' (사용자 기기 날짜)
  day TEXT NOT NULL,
  slot TEXT NOT NULL CHECK (slot IN ('breakfast', 'lunch', 'dinner', 'snack')),
  -- 레시피를 지우면 NULL이 되고 제목만 남는다. '외식'처럼 직접 적은 것도 NULL
  recipe_id TEXT,
  title TEXT NOT NULL,
  servings INTEGER,
  done_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_meal_plans_user_day ON meal_plans (user_id, day);

-- 예전 냉장고(이름 목록)를 '냉장고' 하나로 옮긴다. 양은 모름으로 둔다.
-- 기본 양념 설정(staples)은 pantry에 그대로 남겨 쓴다.
INSERT INTO fridges (id, user_id, name, kind, position, created_at)
  SELECT 'main-' || user_id, user_id, '냉장고', 'fridge', 0, updated_at FROM pantry;

INSERT INTO fridge_items (id, user_id, fridge_id, name, qty, unit, added_at, updated_at)
  SELECT lower(hex(randomblob(8))), p.user_id, 'main-' || p.user_id, trim(j.value), NULL, '', p.updated_at, p.updated_at
  FROM pantry p, json_each(p.items, '$.items') j
  WHERE json_valid(p.items) AND json_type(p.items, '$.items') = 'array' AND trim(j.value) != '';
