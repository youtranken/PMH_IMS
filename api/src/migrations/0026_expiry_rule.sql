-- expiry_rule — chủ: expiry. Luật email tổng hợp "sắp hết hạn" (FR-013): một luật = một email
-- theo kỳ, không phải mail lẻ từng món.
CREATE TABLE expiry_rule (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    kinds jsonb DEFAULT '[]'::jsonb NOT NULL,
    within_days integer DEFAULT 30 NOT NULL,
    recipients jsonb DEFAULT '[]'::jsonb NOT NULL,
    frequency text DEFAULT 'weekly'::text NOT NULL,
    hour integer DEFAULT 8 NOT NULL,
    weekday integer,
    day_of_month integer,
    active boolean DEFAULT true NOT NULL,
    last_sent_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT expiry_rule_dom_check CHECK (((day_of_month IS NULL) OR ((day_of_month >= 1) AND (day_of_month <= 28)))),
    CONSTRAINT expiry_rule_frequency_check CHECK ((frequency = ANY (ARRAY['daily'::text, 'weekly'::text, 'monthly'::text]))),
    CONSTRAINT expiry_rule_hour_check CHECK (((hour >= 0) AND (hour <= 23))),
    CONSTRAINT expiry_rule_weekday_check CHECK (((weekday IS NULL) OR ((weekday >= 1) AND (weekday <= 7)))),
    CONSTRAINT expiry_rule_within_check CHECK (((within_days >= 1) AND (within_days <= 365))),
    CONSTRAINT expiry_rule_pkey PRIMARY KEY (id)
);
CREATE INDEX expiry_rule_active_idx ON expiry_rule USING btree (active) WHERE active;
