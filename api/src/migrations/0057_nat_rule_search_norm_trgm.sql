-- ims:no-transaction
--
-- B-01 — chỉ mục tìm kiếm cho `nat_rule`. Lý do tách file và lý do KHÔNG có file
-- `DROP INDEX CONCURRENTLY` đi trước: xem 0053, nơi ghi đầy đủ một lần cho cả năm file.

CREATE INDEX CONCURRENTLY IF NOT EXISTS nat_rule_search_norm_trgm
  ON nat_rule USING gin (search_norm gin_trgm_ops);
