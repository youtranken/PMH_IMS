-- Số VLAN — thứ mockup vẽ ngay trên mỗi thẻ dải ("VLAN 20") mà bảng thì không có chỗ nào để khai.
--
-- Vì sao cần: ở PMH, dải IP và VLAN đi liền nhau — người ta nói "VLAN 20" chứ không nói
-- "172.16.20.0/24". Thiếu cột này thì con số ấy phải nhét vào ô tên hoặc mô tả, và mỗi người
-- nhét một kiểu ("VLAN20", "vlan 20", "v20") nên lọc theo VLAN là chuyện không làm được.
--
-- 1–4094: dải hợp lệ của 802.1Q. 0 và 4095 là hai giá trị dành riêng của chuẩn, khai vào là
-- khai sai.
ALTER TABLE subnet
  ADD COLUMN vlan integer,
  ADD CONSTRAINT subnet_vlan_check CHECK (vlan IS NULL OR vlan BETWEEN 1 AND 4094);

-- Port map: VLAN của TỪNG CỔNG là `text`, không phải số — "trunk" là giá trị có thật và hay
-- gặp nhất trên cổng uplink (mockup ghi đúng như vậy). Ép kiểu số ở đây là ép người dùng bỏ
-- trống ô cho cổng quan trọng nhất của con switch.
ALTER TABLE device_port
  ADD COLUMN vlan text;
