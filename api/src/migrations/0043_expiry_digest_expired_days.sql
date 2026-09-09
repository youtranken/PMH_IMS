/*
 * EMAIL BÁO CÁO KHÔNG NHÌN LÙI MỘT NĂM NHƯ MÀN HÌNH.
 *
 * `buildPayload` để `includeExpired` trống nên rơi về mặc định của MÀN HÌNH: nhìn lùi 365
 * ngày. Với một thứ gửi hằng tuần thì đó là 52 lá thư liên tiếp cùng chứa một tên miền công
 * ty đã bỏ, một hợp đồng đã chấm dứt. Không ai xử được chúng BẰNG EMAIL — việc phải làm nằm
 * ở màn khác — nên chúng chỉ dạy người nhận đúng một điều: thư này có thứ không cần đọc. Vài
 * tuần sau cả lá thư vào thùng rác, kể cả những dòng thật sự gấp.
 *
 * Mặc định 30 ngày: quá hạn trong vòng một tháng thì vẫn còn là việc đang nóng và nhắc là
 * đúng; quá một tháng mà chưa ai đụng thì email tuần này cũng không đổi được gì.
 *
 * MÀN HÌNH giữ nguyên một năm — nó là thứ người ta KÉO tới xem, và ở đó mục quá hạn 200 ngày
 * mà chưa ai xử chính là thứ nguy hiểm nhất, phải hiện ra.
 */
INSERT INTO system_config (key, value, description) VALUES
  ('expiry.digest_expired_days', '30',
   'Email báo cáo nhìn lùi bao nhiêu ngày để bắt mục ĐÃ quá hạn. Màn hình vẫn nhìn lùi 1 năm (FR-013)')
ON CONFLICT (key) DO NOTHING;
