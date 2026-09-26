-- SEC-01: cookie phiên mang một token ngẫu nhiên; DB chỉ giữ SHA-256 của token đó.
-- `sessions.id` có mặt trong audit_log và ở màn quản trị phiên, nên nó không được là thứ mở cửa.
ALTER TABLE sessions ADD COLUMN token_hash text;

-- Mọi phiên đang mở trước bản này dùng `id` làm cookie, tức đã lộ qua nhật ký: thu hồi hết.
UPDATE sessions
   SET revoked_at = now(), revoked_reason = 'sec-01-token-rotation'
 WHERE revoked_at IS NULL;

-- Hàng cũ nhận một bản băm của byte ngẫu nhiên không ai giữ, để cột được NOT NULL.
UPDATE sessions SET token_hash = encode(sha256(gen_random_bytes(32)), 'hex');

ALTER TABLE sessions ALTER COLUMN token_hash SET NOT NULL;
CREATE UNIQUE INDEX sessions_token_hash_key ON sessions (token_hash);
