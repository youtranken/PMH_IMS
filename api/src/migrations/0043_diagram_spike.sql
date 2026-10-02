-- diagram_spike — chủ: diagrams (AD-3). BẢN THỬ nhúng draw.io (Q-23): một hàng = một bản vẽ theo
-- tên, giữ nguyên XML draw.io để chủ dự án vẽ thử và mở lại được từ máy khác.
--
-- Không phiên bản, không duyệt, không TOTP: đó là việc của Epic 10 trên bảng `diagram` /
-- `diagram_version`. Khi các bảng đó có, bảng này bị bỏ bằng một migration mới (không sửa file này).
--
-- `created_at` để cửa canh rác của E2E (`e2e/leak-guard.ts`) thấy được hàng nào sinh trong lượt chạy.
--
-- Trần 5 MB: khớp trần body JSON riêng của route này ở `app.setup.ts`. Một bản vẽ mạng vài trăm
-- hình cỡ vài trăm KB; trần chặn một lượt lưu nhầm (ảnh dán thẳng vào bản vẽ) làm phình DB.
CREATE TABLE diagram_spike (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name varchar(60) NOT NULL,
    xml text NOT NULL,
    updated_by text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT diagram_spike_pkey PRIMARY KEY (id),
    CONSTRAINT diagram_spike_name_key UNIQUE (name),
    CONSTRAINT diagram_spike_xml_size_check CHECK (octet_length(xml) <= 5242880)
);
