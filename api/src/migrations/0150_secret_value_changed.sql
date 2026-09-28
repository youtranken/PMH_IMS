-- Lúc GIÁ TRỊ trong ngăn két đổi lần cuối, và ai đổi — tách khỏi `updated_at`.
-- `updated_at` nhảy cả khi chỉ sửa tên gọi/ghi chú, nên một mật khẩu nhiều năm chưa đổi vẫn hiện
-- "vừa cập nhật". Hai cột này chỉ đi theo lúc cất và lúc đổi giá trị.
-- Ngăn đã có: lấy `updated_at` (xấp xỉ gần nhất còn giữ được) và người cất. `value_changed_by`
-- để trống được: nơi ghi thẳng bằng SQL không biết cột này thì đọc ra người cất.
ALTER TABLE secret ADD COLUMN value_changed_at timestamptz;
ALTER TABLE secret ADD COLUMN value_changed_by text;
UPDATE secret SET value_changed_at = updated_at, value_changed_by = created_by;
ALTER TABLE secret ALTER COLUMN value_changed_at SET DEFAULT now();
ALTER TABLE secret ALTER COLUMN value_changed_at SET NOT NULL;
