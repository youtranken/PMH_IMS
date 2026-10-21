-- feature_group — chủ: users (Q-31). Nhóm quyền của Thành viên: tên + các ô tick SA chọn.
-- Khóa ô tick khớp FEATURE_TICKS ở `api/src/common/features.ts`; `expiry` / `iso` là khóa suy ra,
-- không bao giờ nằm ở đây.
CREATE TABLE feature_group (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name citext NOT NULL,
    features text[] NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT feature_group_pkey PRIMARY KEY (id),
    CONSTRAINT feature_group_name_key UNIQUE (name),
    CONSTRAINT feature_group_name_check CHECK (length(btrim(name::text)) BETWEEN 1 AND 60),
    CONSTRAINT feature_group_features_check CHECK (
        cardinality(features) >= 1
        AND features <@ ARRAY['overview', 'assets', 'network', 'iso_0203', 'iso_0206', 'iso_0208', 'break_glass']::text[]
    )
);

-- RESTRICT: xoá nhóm còn người là lỗi, không được lặng lẽ trả họ về "Đủ quyền".
ALTER TABLE users ADD COLUMN feature_group_id uuid;
ALTER TABLE users ADD CONSTRAINT users_feature_group_id_fkey
    FOREIGN KEY (feature_group_id) REFERENCES feature_group(id) ON DELETE RESTRICT;
-- SA/Admin luôn đủ quyền: đổi vai khỏi Member phải bỏ nhóm trong cùng câu UPDATE.
ALTER TABLE users ADD CONSTRAINT users_feature_group_member_check
    CHECK (feature_group_id IS NULL OR role = 'member');
CREATE INDEX users_feature_group_idx ON users USING btree (feature_group_id) WHERE (feature_group_id IS NOT NULL);
