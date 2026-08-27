-- Gateway của dải — thứ người ta hỏi ĐẦU TIÊN khi khai IP tĩnh cho một cái máy, mà thẻ dải
-- lại không có chỗ nào để ghi.
--
-- Vì sao cần một cột riêng: thiếu nó thì gateway phải nhét vào ô mô tả ("GW .1", "gw:
-- 172.16.10.1", "default gateway 172.16.10.254"), mỗi người một kiểu — và cái ô quan trọng
-- nhất của một dải mạng trở thành thứ không tra được, không kiểm được, không xuất ra Excel
-- cho tử tế được.
--
-- CHECK ở tầng DB chứ không chỉ ở tầng ứng dụng: gateway nằm ngoài chính dải của nó là một
-- cấu hình sai mà nhìn trên màn hình vẫn thấy hợp lệ — y hệt lý do `ip_address_within_subnet`
-- tồn tại. `<<=` cho phép cả trường hợp dải /32 (gateway trùng chính địa chỉ đó).
ALTER TABLE subnet
  ADD COLUMN gateway inet,
  ADD CONSTRAINT subnet_gateway_within_check CHECK (gateway IS NULL OR gateway <<= cidr);
