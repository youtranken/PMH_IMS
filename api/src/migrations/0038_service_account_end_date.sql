-- service_account.end_date — hạn dùng của tài khoản dịch vụ (Q-20): VPN, tài khoản cấp có thời
-- hạn. NULL = không có hạn. Quá hạn chỉ nhắc, không tự ngừng dùng (IMS không nối tới VPN thật).
-- Cột thêm vào không có DEFAULT nên Postgres không viết lại bảng.
ALTER TABLE service_account ADD COLUMN end_date date;

-- Nguồn hạn chỉ hỏi tài khoản đang dùng có hạn. Bảng chỉ vài chục hàng nên khoá lúc tạo chỉ
-- mục là tức thời; tách ra file no-transaction (CONCURRENTLY) thì phải chiếm thêm một số
-- migration cho một bảng nhỏ đến thế.
CREATE INDEX service_account_end_date_idx ON service_account USING btree (end_date)
    WHERE ((status = 'active'::text) AND (end_date IS NOT NULL));
