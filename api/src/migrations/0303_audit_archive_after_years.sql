-- OLD-DB-03 · ngưỡng lưu trữ ngăn năm của audit_log, đọc bởi `ops/audit-archive.sh`.
-- Để ở system_config (AD-11): giữ bao nhiêu năm trong DB đang chạy là quyết định của phòng IT.
INSERT INTO system_config (key, value, description) VALUES
  ('audit.archive_after_years', '2',
   'Ngăn năm của nhật ký có mọi dòng cũ hơn ngần này năm thì ops/audit-archive.sh tách ra và dump vào thư mục sao lưu. Không tự chạy.')
ON CONFLICT (key) DO NOTHING;
