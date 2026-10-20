-- break_glass_code (Q-30): hai cột cho hai cách mã ĐÚNG bị đếm là sai.
-- `prev_code_hash`: worker dựng lại thư của CÙNG lượt gửi (SMTP đã nhận nhưng chưa kịp đánh dấu
-- xong) thì người duyệt có thể cầm mã của thư trước — giữ HMAC của nó tới khi lượt đó hết.
-- `code_key_version`: phiên bản master key đã dẫn khoá HMAC. Xoay chìa giữa chừng thì vẫn so được
-- bằng đúng khoá cũ; chìa đã gỡ thì coi như mã hết hạn, không trừ lượt nhập.
ALTER TABLE break_glass_code
    ADD COLUMN prev_code_hash text
        CONSTRAINT break_glass_code_prev_hash_check CHECK (prev_code_hash IS NULL OR prev_code_hash ~ '^[0-9a-f]{64}$'),
    ADD COLUMN code_key_version integer;
