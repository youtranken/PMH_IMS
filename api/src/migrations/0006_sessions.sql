-- sessions — chủ: auth. Phiên phía server (AD-8): cookie mang token ngẫu nhiên, DB chỉ giữ
-- SHA-256 của nó (SEC-01) — `id` có mặt trong nhật ký nên không được là thứ mở cửa.
CREATE TABLE sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    csrf_token text NOT NULL,
    ip text,
    user_agent text,
    stepped_up_at timestamp with time zone,
    totp_pending boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    absolute_expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    revoked_reason text,
    stepup_failures integer DEFAULT 0 NOT NULL,
    token_hash text NOT NULL,
    CONSTRAINT sessions_pkey PRIMARY KEY (id),
    CONSTRAINT sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX sessions_last_seen_idx ON sessions USING btree (last_seen_at);
CREATE INDEX sessions_user_idx ON sessions USING btree (user_id) WHERE (revoked_at IS NULL);
CREATE UNIQUE INDEX sessions_token_hash_key ON sessions USING btree (token_hash);
