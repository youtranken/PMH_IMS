-- Số No của job 0203 đang theo dõi không trùng (Q-28): phiếu in theo No, hai dòng cùng số thì đọc
-- sai. Kiểm ở service không đủ vì hai lượt tạo cùng lúc cùng qua bước kiểm.
-- EXCLUDE thay cho unique index một phần vì phải DEFERRABLE: đổi thứ tự job là tráo số hai hàng
-- trong một transaction, và moveJob hoãn kiểm tới lúc commit.
ALTER TABLE iso_backup_job ADD CONSTRAINT iso_backup_job_live_no_excl
    EXCLUDE USING btree (no WITH =) WHERE (stopped_on IS NULL) DEFERRABLE INITIALLY IMMEDIATE;
