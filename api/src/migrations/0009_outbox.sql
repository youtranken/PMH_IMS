-- outbox — chủ: outbox (tầng nền). Mọi email/sự kiện commit CHUNG transaction với lượt ghi
-- nghiệp vụ (AD-5). Chỉ mục riêng phần giữ phần relay phải quét nhỏ mãi.
CREATE TABLE outbox (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    topic text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    claimed_at timestamp with time zone,
    processed_at timestamp with time zone,
    fail_count integer DEFAULT 0 NOT NULL,
    last_error text,
    last_failed_at timestamp with time zone,
    CONSTRAINT outbox_pkey PRIMARY KEY (id)
);
CREATE INDEX outbox_pending_idx ON outbox USING btree (created_at) WHERE (processed_at IS NULL);
CREATE INDEX outbox_processed_at_idx ON outbox USING btree (processed_at) WHERE (processed_at IS NOT NULL);
