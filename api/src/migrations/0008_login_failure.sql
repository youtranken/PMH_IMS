-- login_failure — chủ: auth. Khoá đăng nhập theo "một tài khoản tại một nơi": khoá trên chính
-- hàng users thì ai biết email cũng khoá được người khác ra ngoài (NFR-01).
CREATE TABLE login_failure (
    user_id uuid NOT NULL,
    ip text NOT NULL,
    failed_attempts integer DEFAULT 0 NOT NULL,
    locked_until timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT login_failure_pkey PRIMARY KEY (user_id, ip),
    CONSTRAINT login_failure_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX login_failure_stale_idx ON login_failure USING btree (updated_at);
