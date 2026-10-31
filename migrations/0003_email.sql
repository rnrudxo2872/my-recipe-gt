-- 이메일 인증과 비밀번호 재설정

ALTER TABLE users ADD COLUMN email_verified_at INTEGER;
-- 이 기능 전에 가입한 사람은 인증한 것으로 본다(갑자기 막히지 않게)
UPDATE users SET email_verified_at = created_at;

-- 메일 링크에 넣는 일회용 토큰. 원문은 저장하지 않고 해시만 둔다.
CREATE TABLE email_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- verify: 이메일 인증, reset: 비밀번호 재설정
  kind TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_email_tokens_user ON email_tokens(user_id, kind);
CREATE INDEX idx_email_tokens_expires ON email_tokens(expires_at);
