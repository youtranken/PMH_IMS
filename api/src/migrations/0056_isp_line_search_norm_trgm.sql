-- ims:no-transaction
--
-- B-01 — chỉ mục tìm kiếm cho `isp_line`. Lý do tách file và lý do KHÔNG có file
-- `DROP INDEX CONCURRENTLY` đi trước: xem 0053, nơi ghi đầy đủ một lần cho cả năm file.

CREATE INDEX CONCURRENTLY IF NOT EXISTS isp_line_search_norm_trgm
  ON isp_line USING gin (search_norm gin_trgm_ops);
