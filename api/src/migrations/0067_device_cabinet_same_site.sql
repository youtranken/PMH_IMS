-- BE-08 — thiết bị trong tủ phải cùng site với tủ, và tủ còn thiết bị thì không dời site được.
--
-- `catalog` không được đếm bảng `device` (AD-2), nên trọng tài là khoá ngoại kép: dời tủ
-- (UPDATE cabinet.site_id) khi còn hàng `device` trỏ vào cặp (site cũ, tủ) sẽ bị 23503, bất kể
-- lượt ghi đi qua cửa nào. MATCH SIMPLE: thiết bị không nằm trong tủ (cabinet_id NULL) không
-- bị xét.
--
-- NOT VALID: không quét lại hàng cũ, nên một hồ sơ đã lệch từ trước không chặn được lượt
-- nâng cấp. Ràng buộc vẫn có hiệu lực cho mọi lượt ghi mới ở cả hai bảng; hàng cũ chỉ bị xét
-- khi chính cặp (site_id, cabinet_id) của nó đổi.
ALTER TABLE device
  ADD CONSTRAINT device_cabinet_same_site_fkey
  FOREIGN KEY (site_id, cabinet_id) REFERENCES cabinet (site_id, id)
  ON UPDATE RESTRICT ON DELETE RESTRICT
  NOT VALID;
