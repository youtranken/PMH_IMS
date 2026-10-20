-- Phiếu ISO đợt 1: 0203 theo dõi backup, 0208 theo dõi antivirus, 0206 sự cố (Q-28).
-- Chủ mọi bảng dưới đây: module iso-forms (AD-3). Tên job, tên máy, bộ phận gõ tay, không trỏ
-- vào kho thiết bị.

-- Người phụ trách từng loại phiếu (một chính, một dự phòng). Chưa gán thì chỉ SA/Admin thao tác.
CREATE TABLE iso_form_owner (
    form_type text NOT NULL,
    primary_user_id uuid,
    backup_user_id uuid,
    updated_by text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT iso_form_owner_pkey PRIMARY KEY (form_type),
    CONSTRAINT iso_form_owner_form_type_check CHECK ((form_type = ANY (ARRAY['0203'::text, '0208'::text]))),
    CONSTRAINT iso_form_owner_distinct_check CHECK (((primary_user_id IS NULL) OR (backup_user_id IS NULL) OR (primary_user_id <> backup_user_id))),
    CONSTRAINT iso_form_owner_primary_fkey FOREIGN KEY (primary_user_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT iso_form_owner_backup_fkey FOREIGN KEY (backup_user_id) REFERENCES users(id) ON DELETE SET NULL
);
INSERT INTO iso_form_owner (form_type) VALUES ('0203'), ('0208');

-- Job backup của 0203. Không seed: IT tự tạo trên prod (job #24–29 của mẫu là dòng dư, Q-28).
-- `stopped_on` là ngày cuối còn theo dõi; ngày sau đó để trống và không tính bỏ sót.
CREATE TABLE iso_backup_job (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    no integer NOT NULL,
    name text NOT NULL,
    tracked_from date NOT NULL,
    stopped_on date,
    created_by text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT iso_backup_job_pkey PRIMARY KEY (id),
    CONSTRAINT iso_backup_job_no_check CHECK (((no >= 1) AND (no <= 999))),
    CONSTRAINT iso_backup_job_name_check CHECK (((char_length(btrim(name)) >= 1) AND (char_length(name) <= 120))),
    CONSTRAINT iso_backup_job_stop_check CHECK (((stopped_on IS NULL) OR (stopped_on >= tracked_from)))
);
-- Trùng tên chỉ bị chặn trong danh sách đang theo dõi: job đã ngừng giữ tên ở các kỳ cũ.
CREATE UNIQUE INDEX iso_backup_job_live_name_key ON iso_backup_job USING btree (lower(btrim(name))) WHERE (stopped_on IS NULL);

-- Dòng tick của job: job một dòng có `label` NULL; job có đối tượng con (File Server-1 → OS,
-- Volume_E…) mỗi đối tượng một dòng, có số điểm lưu và nơi lưu riêng như mẫu giấy.
CREATE TABLE iso_backup_line (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_id uuid NOT NULL,
    sort_order integer NOT NULL,
    label text,
    points_nas text,
    storage_nas text,
    points_cloud text,
    storage_cloud text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT iso_backup_line_pkey PRIMARY KEY (id),
    CONSTRAINT iso_backup_line_label_check CHECK (((label IS NULL) OR ((char_length(btrim(label)) >= 1) AND (char_length(label) <= 120)))),
    CONSTRAINT iso_backup_line_text_check CHECK (((COALESCE(char_length(points_nas), 0) <= 20) AND (COALESCE(char_length(storage_nas), 0) <= 60) AND (COALESCE(char_length(points_cloud), 0) <= 20) AND (COALESCE(char_length(storage_cloud), 0) <= 60))),
    CONSTRAINT iso_backup_line_job_id_fkey FOREIGN KEY (job_id) REFERENCES iso_backup_job(id) ON DELETE CASCADE
);
CREATE INDEX iso_backup_line_job_idx ON iso_backup_line USING btree (job_id, sort_order);

-- Ô của lưới 0203: một dòng × một ngày. Ô trống = không có hàng.
CREATE TABLE iso_backup_tick (
    line_id uuid NOT NULL,
    day date NOT NULL,
    result text NOT NULL,
    updated_by text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT iso_backup_tick_pkey PRIMARY KEY (line_id, day),
    CONSTRAINT iso_backup_tick_result_check CHECK ((result = ANY (ARRAY['ok'::text, 'fail'::text]))),
    -- RESTRICT: dòng đã có ô đánh thì không xoá được — sửa job chỉ được ngừng, không xoá dấu vết.
    CONSTRAINT iso_backup_tick_line_id_fkey FOREIGN KEY (line_id) REFERENCES iso_backup_line(id) ON DELETE RESTRICT
);
CREATE INDEX iso_backup_tick_day_idx ON iso_backup_tick USING btree (day);

-- Bộ phận để chọn nhanh khi ghi 0208 (Q-28: chỉ seed một bộ phận làm ví dụ).
CREATE TABLE iso_division (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text,
    name text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT iso_division_pkey PRIMARY KEY (id),
    CONSTRAINT iso_division_code_check CHECK (((code IS NULL) OR ((char_length(btrim(code)) >= 1) AND (char_length(code) <= 20)))),
    CONSTRAINT iso_division_name_check CHECK (((char_length(btrim(name)) >= 1) AND (char_length(name) <= 120)))
);
CREATE UNIQUE INDEX iso_division_name_key ON iso_division USING btree (lower(btrim(name)));
INSERT INTO iso_division (code, name) VALUES ('D&E', 'D&E Division');

-- Ngày 0208 đã kiểm "không có issue".
CREATE TABLE iso_av_clear_day (
    day date NOT NULL,
    marked_by text NOT NULL,
    marked_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT iso_av_clear_day_pkey PRIMARY KEY (day)
);

-- Một dòng 0208 = một lần issue: một máy, một ngày phát hiện (Q-28).
CREATE TABLE iso_av_issue (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    reported_on date NOT NULL,
    division_id uuid NOT NULL,
    computer_name text NOT NULL,
    description text NOT NULL,
    resolved_on date,
    handled_by text,
    created_by text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT iso_av_issue_pkey PRIMARY KEY (id),
    CONSTRAINT iso_av_issue_computer_check CHECK (((char_length(btrim(computer_name)) >= 1) AND (char_length(computer_name) <= 80))),
    CONSTRAINT iso_av_issue_description_check CHECK (((char_length(btrim(description)) >= 1) AND (char_length(description) <= 500))),
    CONSTRAINT iso_av_issue_handled_check CHECK (((handled_by IS NULL) OR (char_length(handled_by) <= 80))),
    CONSTRAINT iso_av_issue_resolved_check CHECK (((resolved_on IS NULL) OR (resolved_on >= reported_on))),
    CONSTRAINT iso_av_issue_division_id_fkey FOREIGN KEY (division_id) REFERENCES iso_division(id) ON DELETE RESTRICT
);
CREATE INDEX iso_av_issue_reported_idx ON iso_av_issue USING btree (reported_on);

-- Bộ đếm số phiếu 0206 theo năm: cấp bằng một câu INSERT … ON CONFLICT DO UPDATE nên hai người
-- lưu cùng lúc không lấy trùng số.
CREATE TABLE iso_incident_counter (
    year integer NOT NULL,
    last_no integer NOT NULL,
    CONSTRAINT iso_incident_counter_pkey PRIMARY KEY (year)
);

-- Phiếu sự cố 0206. Thuộc kỳ của tháng chứa Detection Time (`year`, `month` theo giờ Việt Nam).
-- `content_updated_at` đổi mỗi lần sửa nội dung: bản ký tải lên trước mốc này là bản cũ.
CREATE TABLE iso_incident (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    year integer NOT NULL,
    month integer NOT NULL,
    reported_on date NOT NULL,
    kind text NOT NULL,
    detected_at timestamp with time zone NOT NULL,
    resolved_at timestamp with time zone,
    severity text NOT NULL,
    status text NOT NULL,
    description text NOT NULL,
    corrective_action text DEFAULT ''::text NOT NULL,
    backup_details jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_by text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    content_updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT iso_incident_pkey PRIMARY KEY (id),
    CONSTRAINT iso_incident_month_check CHECK (((month >= 1) AND (month <= 12))),
    CONSTRAINT iso_incident_kind_check CHECK ((kind = ANY (ARRAY['backup'::text, 'server'::text, 'network'::text, 'database'::text, 'other'::text]))),
    CONSTRAINT iso_incident_severity_check CHECK ((severity = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text]))),
    CONSTRAINT iso_incident_status_check CHECK ((status = ANY (ARRAY['temporary_fix'::text, 'resolved'::text, 'in_progress'::text]))),
    CONSTRAINT iso_incident_resolution_check CHECK ((((status = 'in_progress'::text) AND (resolved_at IS NULL)) OR ((status <> 'in_progress'::text) AND (resolved_at IS NOT NULL) AND (resolved_at >= detected_at)))),
    CONSTRAINT iso_incident_text_check CHECK (((char_length(description) <= 2000) AND (char_length(corrective_action) <= 2000)))
);
CREATE UNIQUE INDEX iso_incident_code_key ON iso_incident USING btree (code);
CREATE INDEX iso_incident_period_idx ON iso_incident USING btree (year, month);

-- Ô ✗ gắn vào phiếu 0206: ô 0203 (dòng + ngày) hoặc dòng issue 0208. Một ô chỉ một phiếu.
CREATE TABLE iso_incident_cell (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    incident_id uuid NOT NULL,
    tick_line_id uuid,
    tick_day date,
    av_issue_id uuid,
    CONSTRAINT iso_incident_cell_pkey PRIMARY KEY (id),
    CONSTRAINT iso_incident_cell_one_check CHECK ((((tick_line_id IS NOT NULL) AND (tick_day IS NOT NULL) AND (av_issue_id IS NULL)) OR ((tick_line_id IS NULL) AND (tick_day IS NULL) AND (av_issue_id IS NOT NULL)))),
    CONSTRAINT iso_incident_cell_incident_id_fkey FOREIGN KEY (incident_id) REFERENCES iso_incident(id) ON DELETE CASCADE,
    -- RESTRICT: ô đã gắn phiếu không đổi được sang ✓ / trống, phải bỏ gắn trước.
    CONSTRAINT iso_incident_cell_tick_fkey FOREIGN KEY (tick_line_id, tick_day) REFERENCES iso_backup_tick(line_id, day) ON DELETE RESTRICT,
    CONSTRAINT iso_incident_cell_av_issue_id_fkey FOREIGN KEY (av_issue_id) REFERENCES iso_av_issue(id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX iso_incident_cell_tick_key ON iso_incident_cell USING btree (tick_line_id, tick_day) WHERE (tick_line_id IS NOT NULL);
CREATE UNIQUE INDEX iso_incident_cell_av_key ON iso_incident_cell USING btree (av_issue_id) WHERE (av_issue_id IS NOT NULL);
CREATE INDEX iso_incident_cell_incident_idx ON iso_incident_cell USING btree (incident_id);

-- Kỳ phiếu: tự sinh, có hàng từ lượt ghi đầu tiên của tháng; tháng chưa có hàng là "Đang ghi".
-- Lượt ghi ô khoá hàng FOR SHARE, lượt đổi trạng thái khoá FOR UPDATE. `snapshot` giữ danh sách job /
-- bộ phận lúc gửi chốt (AR-8); `locked_at` là mốc khoá gần nhất — bản ký tải trước mốc này là cũ.
CREATE TABLE iso_period (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    form_type text NOT NULL,
    year integer NOT NULL,
    month integer NOT NULL,
    state text DEFAULT 'open'::text NOT NULL,
    snapshot jsonb,
    submitted_by text,
    submitted_at timestamp with time zone,
    locked_by text,
    locked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT iso_period_pkey PRIMARY KEY (id),
    CONSTRAINT iso_period_form_type_check CHECK ((form_type = ANY (ARRAY['0203'::text, '0208'::text]))),
    CONSTRAINT iso_period_month_check CHECK (((month >= 1) AND (month <= 12))),
    CONSTRAINT iso_period_state_check CHECK ((state = ANY (ARRAY['open'::text, 'pending'::text, 'locked'::text])))
);
CREATE UNIQUE INDEX iso_period_key ON iso_period USING btree (form_type, year, month);

-- Mail nhắc đã gửi: mỗi việc tối đa một mail mỗi ngày. Lượt nhắc CHIẾM hàng trước rồi mới đẩy
-- outbox trong cùng transaction, nên worker chạy lại hay hai worker chạy song song không gửi trùng.
CREATE TABLE iso_reminder_sent (
    reminder_key text NOT NULL,
    sent_on date NOT NULL,
    sent_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT iso_reminder_sent_pkey PRIMARY KEY (reminder_key, sent_on)
);

ALTER TABLE file DROP CONSTRAINT file_owner_type_check;
ALTER TABLE file ADD CONSTRAINT file_owner_type_check CHECK ((owner_type = ANY (ARRAY['device'::text, 'isp'::text, 'software'::text, 'service_account'::text, 'subnet'::text, 'nat_rule'::text, 'device_model'::text, 'software_seat'::text, 'iso_period'::text, 'iso_incident'::text])));

INSERT INTO system_config (key, value, description) VALUES
  ('iso.first_month', '"2026-11"', 'Tháng đầu tiên phiếu ISO ghi trên IMS (YYYY-MM). Tháng trước đó là phiếu giấy'),
  ('iso.backup_system', '"VeamBackup & Replication ( Version 12 )"', 'Dòng "System:" in trên phiếu 0203'),
  ('iso.antivirus_system', '"Sophos"', 'Dòng "System Antivirus:" in trên phiếu 0208'),
  ('iso.scan_max_mb', '20', 'Dung lượng tối đa của một bản scan đã ký (MB), không vượt trần file.max_size_mb'),
  ('iso.scan_types', '"pdf,jpg,png"', 'Loại file nhận làm bản ký phiếu ISO (pdf, jpg, png, webp)'),
  ('iso.remind_hour', '8', 'Giờ trong ngày gửi mail nhắc phiếu ISO (0–23, giờ Việt Nam)'),
  ('iso.remind_backup_after_days', '2', 'Ô còn trống quá ngần này ngày thì mail nhắc gửi thêm cho người phụ trách dự phòng'),
  ('iso.remind_submit_repeat_days', '3', 'Kỳ chưa gửi chốt sau ngày cuối tháng: cứ ngần này ngày nhắc lại một lần'),
  ('iso.remind_approval_days', '2', 'Kỳ hoặc yêu cầu mở lại chờ duyệt quá ngần này ngày thì nhắc lại SA/Admin'),
  ('iso.remind_signed_days', '7', 'Kỳ đã chốt quá ngần này ngày chưa có bản ký thì nhắc người phụ trách'),
  ('iso.remind_in_progress_days', '7', 'Phiếu 0206 In Progress quá ngần này ngày thì nhắc người lập');
