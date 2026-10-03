-- Cây bản vẽ sơ đồ mạng và phiên bản — chủ: diagrams (AD-3, AD-18, Q-23).
--
-- Bản thử `diagram_spike` (0043) bị bỏ: bản vẽ thử không chuyển sang (Q-23). File 0043 giữ
-- nguyên vì bộ chạy kiểm checksum.
DROP TABLE diagram_spike;

-- diagram — một nút của cây Tổng công ty → site → tầng → phòng → tủ. Tầng/phòng chỉ là TÊN bản
-- vẽ (`node_type` chỉ để hiện biểu tượng), không phải danh mục vị trí (Q-23).
--
-- `official_version_id` là cờ "chính thức" của cây: phiên bản chỉ-thêm không UPDATE được, nên
-- phiên bản nào là bản chính thức nằm ở đây (Story phát hành đổi cột này trong cùng tx với duyệt).
-- Không có xoá cứng: `archived_at` là lưu trữ. Tên trùng chỉ cấm giữa các nút anh em còn sống.
CREATE TABLE diagram (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    parent_id uuid,
    name text NOT NULL,
    node_type text NOT NULL,
    site_id uuid,
    cabinet_id uuid,
    owner_email text,
    kind text DEFAULT 'official'::text NOT NULL,
    official_version_id uuid,
    archived_at timestamp with time zone,
    archived_by text,
    created_by text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT diagram_pkey PRIMARY KEY (id),
    CONSTRAINT diagram_name_check CHECK ((char_length(btrim(name)) BETWEEN 1 AND 120)),
    CONSTRAINT diagram_node_type_check CHECK ((node_type = ANY (ARRAY['company'::text, 'site'::text, 'floor'::text, 'room'::text, 'cabinet'::text, 'other'::text]))),
    CONSTRAINT diagram_kind_check CHECK ((kind = ANY (ARRAY['official'::text, 'presentation'::text]))),
    CONSTRAINT diagram_not_own_parent CHECK ((parent_id IS DISTINCT FROM id)),
    CONSTRAINT diagram_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES diagram(id),
    CONSTRAINT diagram_site_id_fkey FOREIGN KEY (site_id) REFERENCES site(id) ON DELETE RESTRICT,
    CONSTRAINT diagram_cabinet_id_fkey FOREIGN KEY (cabinet_id) REFERENCES cabinet(id) ON DELETE RESTRICT
);
CREATE INDEX diagram_parent_idx ON diagram USING btree (parent_id);
CREATE UNIQUE INDEX diagram_sibling_name_key ON diagram USING btree (COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(btrim(name))) WHERE (archived_at IS NULL);

-- diagram_version — mỗi lần lưu là một hàng, CHỈ-THÊM (AD-18): 1–2 năm sau vẫn mở đúng bản lúc
-- đó. Khôi phục là một hàng mới chép XML của bản cũ, không sửa gì.
--
-- `svg` là bản ĐÃ LÀM SẠCH (cổng `diagram-gate.ts`) cho trình xem; `cell_index` là chỉ mục ô cho
-- tóm tắt/so sánh/tự kiểm; `device_snapshot` chụp thông tin thiết bị lúc lưu (AD-14).
-- Trần cỡ khớp trần trên của `diagram.xml_max_kb` / `diagram.svg_max_kb` trên màn Tham số.
CREATE TABLE diagram_version (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    diagram_id uuid NOT NULL,
    seq integer NOT NULL,
    xml text NOT NULL,
    svg text,
    cell_index jsonb NOT NULL,
    device_snapshot jsonb DEFAULT '[]'::jsonb NOT NULL,
    summary text NOT NULL,
    summary_detail jsonb NOT NULL,
    based_on_version_id uuid,
    restored_from_version_id uuid,
    saved_by text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT diagram_version_pkey PRIMARY KEY (id),
    CONSTRAINT diagram_version_seq_key UNIQUE (diagram_id, seq),
    CONSTRAINT diagram_version_xml_size_check CHECK ((octet_length(xml) <= 4194304)),
    CONSTRAINT diagram_version_svg_size_check CHECK ((svg IS NULL OR octet_length(svg) <= 4194304)),
    CONSTRAINT diagram_version_diagram_id_fkey FOREIGN KEY (diagram_id) REFERENCES diagram(id) ON DELETE RESTRICT,
    CONSTRAINT diagram_version_based_on_fkey FOREIGN KEY (based_on_version_id) REFERENCES diagram_version(id),
    CONSTRAINT diagram_version_restored_from_fkey FOREIGN KEY (restored_from_version_id) REFERENCES diagram_version(id)
);
CREATE TRIGGER diagram_version_no_delete BEFORE DELETE ON diagram_version FOR EACH ROW EXECUTE FUNCTION history_append_only();
CREATE TRIGGER diagram_version_no_truncate BEFORE TRUNCATE ON diagram_version FOR EACH STATEMENT EXECUTE FUNCTION append_only_no_truncate();
CREATE TRIGGER diagram_version_no_update BEFORE UPDATE ON diagram_version FOR EACH ROW EXECUTE FUNCTION history_append_only();

ALTER TABLE diagram ADD CONSTRAINT diagram_official_version_fkey FOREIGN KEY (official_version_id) REFERENCES diagram_version(id);

-- diagram_version_label — tên phiên bản quan trọng. Đặt lại tên = thêm hàng, tên mới nhất thắng;
-- `label` NULL = bỏ tên. Chỉ-thêm như phiên bản: tên đặt lúc nào, ai đặt cũng là lịch sử.
CREATE TABLE diagram_version_label (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    diagram_id uuid NOT NULL,
    version_id uuid NOT NULL,
    label text,
    actor text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT diagram_version_label_pkey PRIMARY KEY (id),
    CONSTRAINT diagram_version_label_check CHECK ((label IS NULL OR char_length(btrim(label)) BETWEEN 1 AND 120)),
    CONSTRAINT diagram_version_label_diagram_id_fkey FOREIGN KEY (diagram_id) REFERENCES diagram(id) ON DELETE RESTRICT,
    CONSTRAINT diagram_version_label_version_id_fkey FOREIGN KEY (version_id) REFERENCES diagram_version(id) ON DELETE RESTRICT
);
CREATE INDEX diagram_version_label_idx ON diagram_version_label USING btree (version_id, created_at DESC);
CREATE TRIGGER diagram_version_label_no_delete BEFORE DELETE ON diagram_version_label FOR EACH ROW EXECUTE FUNCTION history_append_only();
CREATE TRIGGER diagram_version_label_no_truncate BEFORE TRUNCATE ON diagram_version_label FOR EACH STATEMENT EXECUTE FUNCTION append_only_no_truncate();
CREATE TRIGGER diagram_version_label_no_update BEFORE UPDATE ON diagram_version_label FOR EACH ROW EXECUTE FUNCTION history_append_only();

-- diagram_history — lịch sử của nút cây (tạo, đổi tên, chuyển nhánh, lưu trữ, lưu/khôi phục
-- phiên bản). Panel lịch sử đọc bảng này, không đọc audit_log (AD-13).
CREATE TABLE diagram_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    diagram_id uuid NOT NULL,
    action text NOT NULL,
    actor text NOT NULL,
    changes jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT diagram_history_pkey PRIMARY KEY (id),
    CONSTRAINT diagram_history_diagram_id_fkey FOREIGN KEY (diagram_id) REFERENCES diagram(id) ON DELETE RESTRICT
);
CREATE INDEX diagram_history_idx ON diagram_history USING btree (diagram_id, created_at DESC);
CREATE TRIGGER diagram_history_no_delete BEFORE DELETE ON diagram_history FOR EACH ROW EXECUTE FUNCTION history_append_only();
CREATE TRIGGER diagram_history_no_truncate BEFORE TRUNCATE ON diagram_history FOR EACH STATEMENT EXECUTE FUNCTION append_only_no_truncate();
CREATE TRIGGER diagram_history_no_update BEFORE UPDATE ON diagram_history FOR EACH ROW EXECUTE FUNCTION history_append_only();

-- Chỉ-thêm (NFR-03, AD-13, AD-18): ims_app chỉ SELECT + INSERT; trigger chặn UPDATE/DELETE/
-- TRUNCATE. Thu cả quyền của chủ sở hữu để một câu UPDATE tay nhầm bảng dừng ở ACL. Trả lại
-- UPDATE cho chủ sở hữu không superuser: phép kiểm khoá ngoại (`SELECT … FOR KEY SHARE`) chạy
-- bằng quyền chủ bảng và cần UPDATE — `diagram.official_version_id`, `based_on_version_id` và
-- `diagram_version_label.version_id` đều trỏ vào `diagram_version`. Trigger vẫn chặn mọi sửa/xoá.
REVOKE UPDATE, DELETE, TRUNCATE ON diagram_version FROM ims_app;
REVOKE UPDATE, DELETE, TRUNCATE ON diagram_version FROM CURRENT_USER;
REVOKE UPDATE, DELETE, TRUNCATE ON diagram_version_label FROM ims_app;
REVOKE UPDATE, DELETE, TRUNCATE ON diagram_version_label FROM CURRENT_USER;
REVOKE UPDATE, DELETE, TRUNCATE ON diagram_history FROM ims_app;
REVOKE UPDATE, DELETE, TRUNCATE ON diagram_history FROM CURRENT_USER;
DO $$
BEGIN
  IF NOT has_table_privilege(current_user, 'diagram_version', 'UPDATE') THEN
    GRANT UPDATE ON diagram_version TO CURRENT_USER;
  END IF;
  IF NOT has_table_privilege(current_user, 'diagram_version_label', 'UPDATE') THEN
    GRANT UPDATE ON diagram_version_label TO CURRENT_USER;
  END IF;
  IF NOT has_table_privilege(current_user, 'diagram_history', 'UPDATE') THEN
    GRANT UPDATE ON diagram_history TO CURRENT_USER;
  END IF;
END $$;

-- diagram_presence — "đang có người mở sửa": mỗi người đang mở màn sửa đập nhịp vài chục giây
-- một lần; hàng quá `diagram.presence_ttl_seconds` coi như đã rời. Bảng chứ không Redis: API chưa
-- có client Redis riêng (BullMQ giữ kết nối của nó), và một hàng mỗi người mỗi bản vẽ thì nhỏ;
-- hàng nguội bị ghi đè ở nhịp sau hoặc xoá khi bản vẽ được dọn.
CREATE TABLE diagram_presence (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    diagram_id uuid NOT NULL,
    user_email text NOT NULL,
    full_name text NOT NULL,
    seen_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT diagram_presence_pkey PRIMARY KEY (id),
    CONSTRAINT diagram_presence_user_key UNIQUE (diagram_id, user_email),
    CONSTRAINT diagram_presence_diagram_id_fkey FOREIGN KEY (diagram_id) REFERENCES diagram(id) ON DELETE CASCADE
);

INSERT INTO system_config (key, value, description) VALUES
  ('diagram.presence_ttl_seconds', '60', 'Người đang mở sửa bản vẽ im lặng quá bao nhiêu giây thì thôi hiện "Đang có … mở sửa bản vẽ này"');
