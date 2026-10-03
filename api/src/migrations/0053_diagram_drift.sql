-- Số lệch kho của bản chính thức — chủ: diagrams (AD-3, AD-18, Q-23 "cảnh báo lệch kho, không ép").
--
-- Đây là BỘ ĐỆM, không phải lịch sử: mỗi bản vẽ một hàng, ghi đè mỗi lần tính lại. Lệch kho luôn
-- tính lại được từ phiên bản (cell_index + device_snapshot) và kho hiện tại, nên không có gì cần
-- giữ lâu; bảng chỉ để (1) cây bản vẽ hiện "lệch kho (N)" mà không phải đọc kho cho mọi bản vẽ, và
-- (2) lượt quét hằng ngày biết số lần trước để chỉ báo khi số TĂNG. Vì vậy KHÔNG chỉ-thêm: ims_app
-- giữ UPDATE (quyền mặc định của 0001).
--
-- `drift_count` = số mới nhất (lượt quét hoặc lần mở bản chính thức ghi); `version_id` = phiên
-- bản chính thức đã tính — bản chính thức đổi thì số cũ không còn đúng, cây bỏ qua nó.
-- `notified_count` = số mà lượt quét đã so lần trước. Lần mở bản vẽ KHÔNG đụng cột này: mở bản
-- vẽ trước lượt quét mà đẩy mốc so lên thì lượt quét không bao giờ thấy số tăng và thư không đi.
-- `swept_at` là trọng tài "mỗi ngày một lượt": hai worker cùng quét thì khoá hàng xếp hàng, người
-- sau thấy hôm nay đã quét và rút. Xoá hàng của bản vẽ/phiên bản (chỉ đường dọn dữ liệu thử) không
-- vướng bộ đệm: CASCADE / SET NULL.
CREATE TABLE diagram_drift (
    diagram_id uuid NOT NULL,
    version_id uuid,
    drift_count integer DEFAULT 0 NOT NULL,
    notified_count integer DEFAULT 0 NOT NULL,
    checked_at timestamp with time zone,
    swept_at timestamp with time zone,
    CONSTRAINT diagram_drift_pkey PRIMARY KEY (diagram_id),
    CONSTRAINT diagram_drift_counts_check CHECK ((drift_count >= 0 AND notified_count >= 0)),
    CONSTRAINT diagram_drift_diagram_id_fkey FOREIGN KEY (diagram_id) REFERENCES diagram(id) ON DELETE CASCADE,
    CONSTRAINT diagram_drift_version_id_fkey FOREIGN KEY (version_id) REFERENCES diagram_version(id) ON DELETE SET NULL
);

INSERT INTO system_config (key, value, description) VALUES
  ('diagram.drift_notify_enabled', '1', 'Lượt quét lệch kho hằng ngày gửi email người phụ trách bản vẽ khi số lệch của bản chính thức tăng (1 = bật, 0 = tắt)'),
  ('diagram.drift_sweep_hour', '7', 'Giờ trong ngày (0–23, theo múi giờ ứng dụng) bắt đầu lượt quét lệch kho của các bản vẽ chính thức');
