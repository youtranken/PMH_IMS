-- DOM-04 (QUYET-DINH Q-04): đường truyền không có ngày kết thúc; line sống tới khi thanh lý.
-- Cột `end_date` ở lại (migration chỉ tiến, dữ liệu cũ không bị xoá) nhưng không còn ai ghi hay
-- đọc nó.

-- Ràng buộc khoảng ngày phải đi: dòng cũ còn `end_date`, người dùng không còn thấy ô đó, nên
-- dời ngày bắt đầu qua cái hạn vô hình ấy sẽ vấp 23514 mà không có câu giải thích nào.
ALTER TABLE isp_line DROP CONSTRAINT IF EXISTS isp_line_range_check;

-- Hai chỉ mục phục vụ quét hạn và sắp theo hạn; cả hai cửa đó đã đóng.
DROP INDEX IF EXISTS isp_line_end_idx;
DROP INDEX IF EXISTS isp_line_end_code_idx;
