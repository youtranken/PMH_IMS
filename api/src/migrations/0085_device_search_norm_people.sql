-- Tìm thiết bị theo người sử dụng và bộ phận (Q-14): "máy của chị Bình đâu?".
--
-- Cột sinh không đổi biểu thức tại chỗ được, nên gỡ ra rồi dựng lại y như 0052, chỉ thêm
-- `assigned_to` và `department`. Gỡ cột thì chỉ mục `device_search_norm_trgm` (0053) đi theo;
-- 0086 dựng lại nó bằng CONCURRENTLY để phần đắt không giữ khoá bảng.
--
-- Nối bằng `coalesce(...) || ' ' || ...` chứ không `concat_ws` — cùng lý do ở 0052 (`concat_ws`
-- là STABLE, cột sinh từ chối).

ALTER TABLE device DROP COLUMN search_norm;

ALTER TABLE device ADD COLUMN search_norm text
  GENERATED ALWAYS AS (ims_norm(
    code::text || ' ' || name || ' ' || coalesce(serial, '') || ' ' || coalesce(model, '')
      || ' ' || coalesce(assigned_to, '') || ' ' || coalesce(department, '')
  )) STORED;
