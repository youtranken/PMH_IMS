-- Người dùng (NFR-01). Không tự đăng ký: SA tạo tài khoản.
-- Không DELETE bao giờ (convention "Xóa") — chỉ đổi status.
CREATE TABLE users (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email                 citext NOT NULL UNIQUE,
  full_name             text NOT NULL,
  role                  text NOT NULL,
  password_hash         text NOT NULL,
  must_change_password  boolean NOT NULL DEFAULT true,
  -- TOTP: secret cất bằng envelope AES-256-GCM (AD-4/NFR-02), KHÔNG plaintext.
  totp_secret_ct        bytea,
  totp_secret_iv        bytea,
  totp_secret_tag       bytea,
  totp_dek_wrapped      bytea,
  totp_key_version      integer,
  totp_enrolled_at      timestamptz,
  -- Chống replay (NFR-01): timestep đã dùng không được dùng lại.
  totp_last_timestep    bigint,
  -- Cưỡng chế TOTP khi đăng nhập, bật/tắt theo từng người (NFR-01).
  totp_login_required   boolean NOT NULL DEFAULT true,
  failed_attempts       integer NOT NULL DEFAULT 0,
  locked_until          timestamptz,
  status                text NOT NULL DEFAULT 'active',
  last_login_at         timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_role_check   CHECK (role IN ('sa', 'admin', 'member')),
  CONSTRAINT users_status_check CHECK (status IN ('active', 'locked', 'disabled'))
);

-- NFR-01 "2 SA": ràng buộc mềm ở tầng nghiệp vụ (không cho hạ SA cuối cùng);
-- index này phục vụ đếm nhanh.
CREATE INDEX users_role_idx ON users (role) WHERE status = 'active';
