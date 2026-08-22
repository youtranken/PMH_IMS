-- Phiên server-side (AD-8). Cookie chỉ mang session id; mọi quyết định ở DB.
CREATE TABLE sessions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES users (id),
  csrf_token          text NOT NULL,
  ip                  text,
  user_agent          text,
  -- Step-up TOTP để xem secret (FR-022): mốc lần gõ TOTP gần nhất; grace tính từ đây.
  stepped_up_at       timestamptz,
  -- Đăng nhập 2 bước (NFR-01): đúng mật khẩu nhưng CHƯA qua TOTP → phiên chỉ mở được
  -- đúng vài route (nhập TOTP / enroll). Qua TOTP xong thì phiên này bị hủy và cấp phiên
  -- mới (regenerate session id sau khi xác thực đủ).
  totp_pending        boolean NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now(),
  last_seen_at        timestamptz NOT NULL DEFAULT now(),
  absolute_expires_at timestamptz NOT NULL,
  revoked_at          timestamptz,
  revoked_reason      text
);
CREATE INDEX sessions_user_idx ON sessions (user_id) WHERE revoked_at IS NULL;
CREATE INDEX sessions_last_seen_idx ON sessions (last_seen_at);
