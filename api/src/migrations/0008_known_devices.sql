-- NFR-01: đăng nhập từ thiết bị/trình duyệt mới → email báo chính chủ.
-- Nhận diện bằng hash(user_agent + ip/24) — không lưu fingerprint thô.
CREATE TABLE known_device (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users (id),
  device_hash  text NOT NULL,
  label        text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, device_hash)
);
