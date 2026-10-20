-- break_glass_code — chủ: vault (Q-30). Mã duyệt "Xin mở két" của một yêu cầu đang chờ: người duyệt
-- người xin đã chọn, mã HIỆN HÀNH (chỉ HMAC, không bao giờ lưu mã rõ) và các bộ đếm chống dò.
-- `send_no` tăng mỗi lần gửi lại: thư của lượt cũ còn kẹt trong hàng đợi so số này để không dựng
-- mã cho một lượt đã bị thay. `failed_attempts` cộng dồn qua mọi lần gửi lại, nên gửi lại mã không
-- mở thêm lượt đoán.
CREATE TABLE break_glass_code (
    approval_id uuid NOT NULL,
    approver text NOT NULL,
    send_no integer DEFAULT 1 NOT NULL,
    code_hash text,
    code_expires_at timestamp with time zone,
    failed_attempts integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT break_glass_code_pkey PRIMARY KEY (approval_id),
    CONSTRAINT break_glass_code_send_no_check CHECK (send_no BETWEEN 1 AND 4),
    CONSTRAINT break_glass_code_failed_check CHECK (failed_attempts >= 0),
    CONSTRAINT break_glass_code_hash_check CHECK (code_hash IS NULL OR code_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT break_glass_code_pair_check CHECK ((code_hash IS NULL) = (code_expires_at IS NULL)),
    -- CASCADE: mã chỉ có nghĩa cùng yêu cầu của nó.
    CONSTRAINT break_glass_code_approval_id_fkey FOREIGN KEY (approval_id) REFERENCES approval(id) ON DELETE CASCADE
);
