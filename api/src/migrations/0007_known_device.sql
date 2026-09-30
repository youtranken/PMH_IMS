-- known_device — chủ: auth. Đăng nhập từ thiết bị mới thì báo chính chủ (NFR-01). Nhận diện bằng
-- hash, không lưu fingerprint thô.
CREATE TABLE known_device (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    device_hash text NOT NULL,
    label text,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT known_device_pkey PRIMARY KEY (id),
    CONSTRAINT known_device_user_id_device_hash_key UNIQUE (user_id, device_hash),
    CONSTRAINT known_device_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id)
);
