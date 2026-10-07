-- Model thiết bị thành danh mục có đặc tính (Q-26) — chủ: devices (AD-3). Mở rộng `device_model` của
-- 0054 chứ không dựng bảng thứ hai: ảnh model đã nằm ở đây.
--
-- `model_key` chặn model tách đôi vì gõ khác nhau ("C9300-48P" và "c9300 48p" cùng một khoá): viết
-- HOA, bỏ khoảng trắng, gạch ngang, gạch dưới, chấm. Khoá là UNIQUE trên toàn bảng chứ không theo
-- loại — một mã model của hãng chỉ là một sản phẩm; khoá theo loại thì chọn nhầm loại là ra bản
-- thứ hai. Cùng phép chuẩn hoá với `modelKey()` của api (test:db so hai bên).
--
-- `manufacturer` là chữ (hãng sản xuất), KHÔNG trỏ `vendor`: `vendor` là nhà cung cấp/NCC (nơi mua)
-- của FR-001, hai thứ khác nhau.
--
-- Gắn tủ thì có Số U, không gắn tủ thì không — máy thuộc model lấy Số U từ đây, không sửa đè (cùng
-- model là cùng kích thước vật lý).
--
-- `device.device_model_id` để trống được: máy cũ "chưa có Model" chạy như trước (Số U, ảnh khai trên
-- máy, ảnh model dò theo loại + chuỗi model). Không xoá được model còn máy dùng.
ALTER TABLE device_model
    ADD COLUMN manufacturer text,
    ADD COLUMN rack_mountable boolean DEFAULT false NOT NULL,
    ADD COLUMN u_size smallint,
    ADD COLUMN model_key text GENERATED ALWAYS AS (upper(regexp_replace(model, '[[:space:]_.-]', '', 'g'))) STORED,
    ADD CONSTRAINT device_model_manufacturer_check CHECK (((manufacturer IS NULL) OR (char_length(btrim(manufacturer)) BETWEEN 1 AND 60))),
    ADD CONSTRAINT device_model_u_size_check CHECK ((rack_mountable = (u_size IS NOT NULL)) AND ((u_size IS NULL) OR (u_size BETWEEN 1 AND 60))),
    ADD CONSTRAINT device_model_model_key_check CHECK ((char_length(model_key) >= 1));
DROP INDEX device_model_type_model_key;
-- Hàng có sẵn mà nay trùng khoá (0054 chỉ chặn trùng theo loại + lower/btrim): gộp về hàng tạo trước
-- nhất của mỗi khoá. Ảnh còn trống của hàng giữ lấy từ hàng bị gộp, tệp ảnh chuyển chủ. Chưa có máy
-- nào trỏ model bằng khoá ngoại (cột thêm ngay dưới) nên gộp không đụng thiết bị.
UPDATE device_model k
   SET photo_front_file_id = COALESCE(k.photo_front_file_id, (SELECT d.photo_front_file_id FROM device_model d
         WHERE d.model_key = k.model_key AND d.id <> k.id AND d.photo_front_file_id IS NOT NULL ORDER BY d.created_at, d.id LIMIT 1)),
       photo_back_file_id = COALESCE(k.photo_back_file_id, (SELECT d.photo_back_file_id FROM device_model d
         WHERE d.model_key = k.model_key AND d.id <> k.id AND d.photo_back_file_id IS NOT NULL ORDER BY d.created_at, d.id LIMIT 1))
 WHERE k.id = (SELECT x.id FROM device_model x WHERE x.model_key = k.model_key ORDER BY x.created_at, x.id LIMIT 1);
UPDATE file f
   SET owner_id = (SELECT x.id FROM device_model x WHERE x.model_key = d.model_key ORDER BY x.created_at, x.id LIMIT 1)
  FROM device_model d
 WHERE f.owner_type = 'device_model' AND f.owner_id = d.id
   AND d.id <> (SELECT x.id FROM device_model x WHERE x.model_key = d.model_key ORDER BY x.created_at, x.id LIMIT 1);
DELETE FROM device_model d
 WHERE d.id <> (SELECT x.id FROM device_model x WHERE x.model_key = d.model_key ORDER BY x.created_at, x.id LIMIT 1);
CREATE UNIQUE INDEX device_model_model_key_key ON device_model USING btree (model_key);

ALTER TABLE device
    ADD COLUMN device_model_id uuid,
    ADD CONSTRAINT device_device_model_id_fkey FOREIGN KEY (device_model_id) REFERENCES device_model(id) ON DELETE RESTRICT;
CREATE INDEX device_device_model_idx ON device USING btree (device_model_id) WHERE (device_model_id IS NOT NULL);
