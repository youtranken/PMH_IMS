-- ✓ Other Division do bấm ✓ ở dòng máy duy nhất của tháng (Q-28, bấm từng dòng) nhớ dòng đã kéo nó,
-- để bấm dòng đó sang ✗ / trống thì gỡ đúng dấu tự động mà không đụng dấu người dùng tick tay.
ALTER TABLE iso_av_clear_day ADD COLUMN auto_issue_id uuid
    CONSTRAINT iso_av_clear_day_auto_issue_id_fkey REFERENCES iso_av_issue(id) ON DELETE CASCADE;
