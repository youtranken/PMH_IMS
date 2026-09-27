-- ims:no-transaction
--
-- BE-08 — khoá (site_id, id) của tủ, để 0067 dựng khoá ngoại kép từ `device` trỏ vào.
-- `id` đã là khoá chính nên cặp này luôn duy nhất; chỉ mục tồn tại vì khoá ngoại cần một
-- chỉ mục duy nhất đúng trên hai cột được tham chiếu. Tách file vì CONCURRENTLY không chạy
-- được trong transaction.

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS cabinet_site_id_key ON cabinet (site_id, id);
