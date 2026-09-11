/*
 * KHOÁ ĐĂNG NHẬP CHUYỂN TỪ "MỘT TÀI KHOẢN" SANG "MỘT TÀI KHOẢN TẠI MỘT NƠI".
 *
 * ===== LỖ ĐANG VÁ =====
 *
 * NFR-01 nói "sai N lần liên tiếp thì khoá M phút", và bản cài đặt đặt bộ đếm lên chính hàng
 * `users`. Hệ quả không ai định: khoá đó ai kích cũng được. Biết email của một người là khoá
 * được họ ra ngoài, năm request là xong, và lặp lại bao nhiêu lần tuỳ thích.
 *
 * Trần theo IP (`login.rate_limit_per_ip`, cửa sổ 60 giây) không cứu được: khoá chỉ cần 5
 * lượt, còn trần thì cao hơn thế nhiều, nên một IP khoá được khoảng 4 tài khoản mỗi phút. Một
 * buổi sáng là hết công ty.
 *
 * Và người đáng khoá nhất chính là SA, đúng lúc đang có sự cố cần đăng nhập để xử lý. Một
 * công cụ quản trị mà người lạ tắt được đường vào của quản trị viên là lỗ về TÍNH SẴN SÀNG,
 * không phải chuyện lý thuyết.
 *
 * ===== VÌ SAO KHOÁ THEO CẶP (NGƯỜI DÙNG, IP) =====
 *
 * Khoá sinh ra để chặn một người đang ĐOÁN. Người đoán ngồi ở một chỗ, nên chặn đúng chỗ đó
 * là đủ — và người dùng thật, ngồi ở bàn của họ, không việc gì phải chịu hậu quả của việc kẻ
 * khác gõ sai. Đây cũng là hướng NIST SP 800-63B khuyến nghị: tiết lưu theo nguồn, đừng khoá
 * cứng theo danh tính.
 *
 * Kẻ tấn công có nhiều IP thì mỗi IP vẫn chỉ được N lượt, và `login.rate_limit_per_ip` chặn
 * tốc độ của từng IP. Cái KHÔNG còn nữa là đòn bẩy: trước đây 5 request khoá được một người;
 * giờ 5 request chỉ khoá được chính cái IP đang gõ.
 *
 * ===== BỘ ĐẾM TRÊN `users` KHÔNG BỊ XOÁ — NÓ ĐỔI VAI =====
 *
 * `users.failed_attempts` / `users.locked_until` vẫn được cộng và vẫn quyết định lúc nào bắn
 * thư báo SA, nhưng KHÔNG còn chặn ai nữa. Đó là chỗ duy nhất nhìn thấy bức tranh toàn cục
 * "tài khoản này đang bị dò từ nhiều nơi" — thứ mà bộ đếm theo cặp, chia nhỏ theo IP, không
 * bao giờ thấy. `locked_until` giữ nguyên tên cột nhưng nay là CỬA SỔ CHỐNG SPAM THƯ: không
 * báo lại cho tới khi nó qua, nếu không SA nhận một thư cho mỗi lượt gõ sai.
 *
 * Cố ý KHÔNG đặt thêm một trần chặn ở tầng tài khoản, dù ở mức cao: kẻ nào gõ được 5 lượt thì
 * cũng gõ được 50, nên mọi ngưỡng chặn theo tài khoản đều làm đòn bẩy DoS sống lại, chỉ đắt
 * hơn mười lần. Hàng rào chống dò rải rác là: trần theo IP, TOTP, luật mật khẩu, và lá thư
 * báo SA ở trên để có một CON NGƯỜI nhìn thấy.
 *
 * SA KHOÁ TAY (`users.status = 'locked'`) không đụng tới — đó là hành động có chủ ý của một
 * người có thẩm quyền, và nó vẫn chặn đăng nhập như cũ.
 */
CREATE TABLE login_failure (
  user_id         uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  /*
   * `text` chứ không `inet`: khoá này phải khớp đúng thứ `LoginRateGuard` đang dùng làm khoá
   * (`req.ip`), kể cả khi không lấy được IP — lúc đó cả hai dùng chuỗi 'unknown'. Ép `inet`
   * thì hàng 'unknown' không tồn tại được, và nhánh không-có-IP lặng lẽ mất hàng rào.
   */
  ip              text NOT NULL,
  failed_attempts integer NOT NULL DEFAULT 0,
  locked_until    timestamptz,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, ip)
);

/*
 * Dọn rác theo `updated_at`: mỗi cặp (người dùng, IP) từng gõ sai để lại một hàng, nên một
 * lượt dò rải rác từ 100 nghìn IP để lại 100 nghìn hàng. Sweeper xoá hàng đã nguội — xem
 * `LoginFailureService.pruneStale`.
 */
CREATE INDEX login_failure_stale_idx ON login_failure (updated_at);
