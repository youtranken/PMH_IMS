-- users — chủ: users. SA tạo tài khoản, không tự đăng ký (NFR-01). Không DELETE: chỉ đổi status.
-- TOTP cất bằng envelope AES-256-GCM (NFR-02); `totp_last_timestep` chống dùng lại mã (NFR-01).
-- Bộ đếm sai và `locked_until` chặn theo TÀI KHOẢN, chậm dần (Q-06).
CREATE TABLE users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email citext NOT NULL,
    full_name text NOT NULL,
    role text NOT NULL,
    password_hash text NOT NULL,
    must_change_password boolean DEFAULT true NOT NULL,
    totp_secret_ct bytea,
    totp_secret_iv bytea,
    totp_secret_tag bytea,
    totp_dek_wrapped bytea,
    totp_key_version integer,
    totp_enrolled_at timestamp with time zone,
    totp_last_timestep bigint,
    totp_login_required boolean DEFAULT true NOT NULL,
    failed_attempts integer DEFAULT 0 NOT NULL,
    locked_until timestamp with time zone,
    status text DEFAULT 'active'::text NOT NULL,
    last_login_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    phone text,
    employee_code text,
    birth_date date,
    CONSTRAINT users_role_check CHECK ((role = ANY (ARRAY['sa'::text, 'admin'::text, 'member'::text]))),
    CONSTRAINT users_status_check CHECK ((status = ANY (ARRAY['active'::text, 'locked'::text, 'disabled'::text]))),
    CONSTRAINT users_email_key UNIQUE (email),
    CONSTRAINT users_pkey PRIMARY KEY (id)
);
CREATE INDEX users_role_idx ON users USING btree (role) WHERE (status = 'active'::text);
CREATE UNIQUE INDEX users_employee_code_uq ON users USING btree (employee_code) WHERE (employee_code IS NOT NULL);
