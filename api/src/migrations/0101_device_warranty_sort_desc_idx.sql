-- ims:no-transaction
--
-- Cặp của 0100 cho chiều GIẢM DẦN: vẫn thanh lý/chưa khai hạn ở cuối, nên hai cột sau đổi chiều
-- còn cột đầu thì không — một chỉ mục quét ngược không phục vụ được thứ tự lệch chiều này.

CREATE INDEX CONCURRENTLY IF NOT EXISTS device_warranty_sort_desc_idx
  ON device ((status = 'retired'), warranty_end DESC NULLS LAST, code DESC);
