-- Vị trí U trong tủ và ảnh thật của thiết bị — chủ: devices (AD-3, Q-23 "chồng U trong cùng tủ thì
-- chặn", "ảnh theo model định danh bằng loại thiết bị + chuỗi model").
--
-- `rack_u_start` = U thấp nhất máy chiếm (U1 ở đáy tủ), `rack_u_size` = số U. Hai cột cùng có hoặc
-- cùng trống, và chỉ có khi máy gắn tủ. Trần 60 khớp `cabinet_u_height_check`; vượt chiều cao của
-- CHÍNH tủ đó thì service chặn (đọc `cabinet.u_height` qua catalog.api) — tủ đổi chiều cao sau này
-- không được làm hồ sơ cũ hết lưu được, nên luật đó không nằm ở CHECK.
--
-- `device_rack_u_no_overlap` là lưới cuối của luật chồng U: service khoá theo tủ rồi kiểm để báo tên
-- máy đang chiếm, còn hai lượt ghi lọt qua cùng lúc thì ràng buộc này chặn lượt sau. Máy đã thanh
-- lý không giữ chỗ trong tủ (đã rời tủ thật).
ALTER TABLE device
    ADD COLUMN rack_u_start smallint,
    ADD COLUMN rack_u_size smallint,
    ADD COLUMN photo_front_file_id uuid,
    ADD COLUMN photo_back_file_id uuid,
    ADD CONSTRAINT device_rack_u_pair_check CHECK (((rack_u_start IS NULL) = (rack_u_size IS NULL))),
    ADD CONSTRAINT device_rack_u_range_check CHECK (((rack_u_start IS NULL) OR ((rack_u_start BETWEEN 1 AND 60) AND (rack_u_size BETWEEN 1 AND 60) AND ((rack_u_start + rack_u_size - 1) <= 60)))),
    ADD CONSTRAINT device_rack_u_cabinet_check CHECK (((rack_u_start IS NULL) OR (cabinet_id IS NOT NULL))),
    ADD CONSTRAINT device_rack_u_no_overlap EXCLUDE USING gist (cabinet_id WITH =, int4range((rack_u_start)::integer, ((rack_u_start + rack_u_size))::integer) WITH &&) WHERE (((rack_u_start IS NOT NULL) AND (status <> 'retired'::text))),
    ADD CONSTRAINT device_photo_front_file_id_fkey FOREIGN KEY (photo_front_file_id) REFERENCES file(id) ON DELETE RESTRICT,
    ADD CONSTRAINT device_photo_back_file_id_fkey FOREIGN KEY (photo_back_file_id) REFERENCES file(id) ON DELETE RESTRICT;

-- device_model — ảnh thật mức model: một hàng cho mỗi (loại thiết bị, chuỗi model), so model không
-- phân biệt hoa thường và khoảng trắng hai đầu. Ảnh tải lên là tệp `files` mang
-- `owner_type = 'device_model'`, `owner_id` = hàng này. Ảnh của từng máy (cột `device.photo_*`)
-- thắng ảnh model.
CREATE TABLE device_model (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    device_type_id uuid NOT NULL,
    model text NOT NULL,
    photo_front_file_id uuid,
    photo_back_file_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT device_model_pkey PRIMARY KEY (id),
    CONSTRAINT device_model_model_check CHECK ((char_length(btrim(model)) BETWEEN 1 AND 120)),
    CONSTRAINT device_model_device_type_id_fkey FOREIGN KEY (device_type_id) REFERENCES device_type(id) ON DELETE RESTRICT,
    CONSTRAINT device_model_photo_front_file_id_fkey FOREIGN KEY (photo_front_file_id) REFERENCES file(id) ON DELETE RESTRICT,
    CONSTRAINT device_model_photo_back_file_id_fkey FOREIGN KEY (photo_back_file_id) REFERENCES file(id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX device_model_type_model_key ON device_model USING btree (device_type_id, lower(btrim(model)));

ALTER TABLE file DROP CONSTRAINT file_owner_type_check;
ALTER TABLE file ADD CONSTRAINT file_owner_type_check CHECK ((owner_type = ANY (ARRAY['device'::text, 'isp'::text, 'software'::text, 'service_account'::text, 'subnet'::text, 'nat_rule'::text, 'device_model'::text])));

INSERT INTO system_config (key, value, description) VALUES
  ('diagram.photo_max_px', '480', 'Cạnh dài nhất (điểm ảnh) của ảnh thật thiết bị khi đưa vào bản vẽ; ảnh gốc lớn hơn được thu nhỏ — lớn quá làm bản vẽ nặng và chạm trần dung lượng');
