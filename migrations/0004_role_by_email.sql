-- 초대 코드 대신, 관리자가 이메일로 권한을 정한다.
DROP TABLE IF EXISTS invites;

-- 아직 가입하지 않은 이메일에 미리 정해 둔 권한. 그 이메일로 가입해 인증을 마치면 적용하고 지운다.
CREATE TABLE role_grants (
  email TEXT PRIMARY KEY COLLATE NOCASE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'friend', 'member')),
  created_by INTEGER,
  created_at INTEGER NOT NULL
);
