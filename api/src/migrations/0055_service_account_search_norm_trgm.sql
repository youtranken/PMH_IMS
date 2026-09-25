-- ims:no-transaction
--
-- B-01 — chỉ mục tìm kiếm cho `service_account`. Lý do tách file và lý do KHÔNG có file
-- `DROP INDEX CONCURRENTLY` đi trước: xem 0053, nơi ghi đầy đủ một lần cho cả năm file.

CREATE INDEX CONCURRENTLY IF NOT EXISTS service_account_search_norm_trgm
  ON service_account USING gin (search_norm gin_trgm_ops);
