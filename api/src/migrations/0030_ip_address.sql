-- ip_address — chủ: ipam. Hai trạng thái 'free'/'assigned' (Q-02). IP trùng trong dải bị chặn ở
-- DB (AC 5.1). FK thiết bị RESTRICT: xoá thiết bị đang giữ IP phải là hành động có ý thức.
-- IP phải nằm trong dải của nó (FR-018). Trigger chứ không CHECK vì phải đọc bảng `subnet`.
CREATE FUNCTION ip_address_within_subnet() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  parent cidr;
BEGIN
  /*
   * Hàng đã ẩn được miễn: ẩn là đường DỌN. Không có dòng này thì `voidSubnet` ẩn hàng loạt
   * IP của một dải đã thu hẹp sẽ nổ giữa transaction, tức mất đường duy nhất để dọn dải
   * hỏng. Hàng đã ẩn không hiện ở đâu và không cấp cho máy nào được, nên nằm ngoài dải
   * cũng không hại ai.
   */
  IF NEW.voided_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  /*
   * `FOR SHARE` chứ không phải SELECT trần: giữ hàng subnet lại cho tới khi lượt ghi này
   * commit, nên không ai đổi được dải ra sau lưng nó.
   */
  SELECT cidr INTO parent FROM subnet WHERE id = NEW.subnet_id FOR SHARE;
  IF parent IS NULL THEN
    RAISE EXCEPTION 'Subnet % không tồn tại', NEW.subnet_id;
  END IF;
  IF NOT (NEW.address <<= parent) THEN
    RAISE EXCEPTION 'Địa chỉ % không nằm trong dải %', NEW.address, parent
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TABLE ip_address (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subnet_id uuid NOT NULL,
    address inet NOT NULL,
    device_id uuid,
    used_by text,
    assigned_by text NOT NULL,
    assigned_at date,
    status text DEFAULT 'assigned'::text NOT NULL,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    voided_at timestamp with time zone,
    voided_by text,
    void_reason text,
    CONSTRAINT ip_address_ipv4_check CHECK ((family(address) = 4)),
    CONSTRAINT ip_address_status_check CHECK ((status = ANY (ARRAY['free'::text, 'assigned'::text]))),
    CONSTRAINT ip_address_void_check CHECK ((((voided_at IS NULL) AND (voided_by IS NULL) AND (void_reason IS NULL)) OR ((voided_at IS NOT NULL) AND (voided_by IS NOT NULL) AND (void_reason IS NOT NULL)))),
    CONSTRAINT ip_address_pkey PRIMARY KEY (id),
    CONSTRAINT ip_address_device_id_fkey FOREIGN KEY (device_id) REFERENCES device(id) ON DELETE RESTRICT,
    CONSTRAINT ip_address_subnet_id_fkey FOREIGN KEY (subnet_id) REFERENCES subnet(id) ON DELETE RESTRICT
);
CREATE INDEX ip_address_device_idx ON ip_address USING btree (device_id) WHERE (voided_at IS NULL);
CREATE INDEX ip_address_status_idx ON ip_address USING btree (status) WHERE (voided_at IS NULL);
CREATE UNIQUE INDEX ip_address_key ON ip_address USING btree (subnet_id, address) WHERE (voided_at IS NULL);
CREATE TRIGGER ip_address_within_subnet_ins BEFORE INSERT ON ip_address FOR EACH ROW EXECUTE FUNCTION ip_address_within_subnet();
CREATE TRIGGER ip_address_within_subnet_upd BEFORE UPDATE OF address, subnet_id, voided_at ON ip_address FOR EACH ROW EXECUTE FUNCTION ip_address_within_subnet();

-- ip_history — lịch sử vòng đời IP, giữ vĩnh viễn (AC 5.2): "IP này từng là máy in kế toán" phải
-- trả lời được nhiều năm sau.
CREATE TABLE ip_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ip_address_id uuid NOT NULL,
    action text NOT NULL,
    actor text NOT NULL,
    from_status text,
    to_status text,
    changes jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ip_history_pkey PRIMARY KEY (id),
    CONSTRAINT ip_history_ip_address_id_fkey FOREIGN KEY (ip_address_id) REFERENCES ip_address(id) ON DELETE RESTRICT
);
CREATE INDEX ip_history_ip_idx ON ip_history USING btree (ip_address_id, created_at DESC);
CREATE TRIGGER ip_history_no_delete BEFORE DELETE ON ip_history FOR EACH ROW EXECUTE FUNCTION history_append_only();
CREATE TRIGGER ip_history_no_truncate BEFORE TRUNCATE ON ip_history FOR EACH STATEMENT EXECUTE FUNCTION append_only_no_truncate();
CREATE TRIGGER ip_history_no_update BEFORE UPDATE ON ip_history FOR EACH ROW EXECUTE FUNCTION history_append_only();

-- Chỉ-thêm (NFR-03, AD-13): ims_app chỉ SELECT + INSERT; trigger chặn UPDATE/DELETE/TRUNCATE.
-- Thu cả quyền của chính chủ sở hữu, để một câu UPDATE tay nhầm bảng dừng ở ACL trước khi tới
-- trigger (vô hiệu với superuser, có hiệu lực với `ims_owner` — DB-03).
-- Nhưng trả lại UPDATE cho chủ sở hữu không superuser: phép kiểm khoá ngoại khi xoá bảng cha
-- (`SELECT … FOR KEY SHARE` trên bảng con) chạy bằng quyền CHỦ bảng con và cần UPDATE, thiếu nó
-- thì mọi lệnh xoá bảng cha chết với "permission denied". Trigger vẫn chặn mọi UPDATE/DELETE, và
-- ims_app không được gì thêm. Superuser thì has_table_privilege luôn đúng nên không cấp gì.
REVOKE UPDATE, DELETE, TRUNCATE ON ip_history FROM ims_app;
REVOKE UPDATE, DELETE, TRUNCATE ON ip_history FROM CURRENT_USER;
DO $$
BEGIN
  IF NOT has_table_privilege(current_user, 'ip_history', 'UPDATE') THEN
    GRANT UPDATE ON ip_history TO CURRENT_USER;
  END IF;
END $$;
