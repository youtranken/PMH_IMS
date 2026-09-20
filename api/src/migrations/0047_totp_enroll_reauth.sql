/*
 * ĐÒI XÁC THỰC LẠI TRƯỚC KHI GẮN YẾU TỐ THỨ HAI (20/09/2026) — A-02 của rà soát 19/09.
 *
 * ===== LỖ ĐANG VÁ =====
 *
 * `POST /auth/totp/enroll` chỉ đòi một phiên đã đăng nhập, và với tài khoản CHƯA cài 2 lớp
 * thì nó trả về secret base32 nguyên văn. Một cái cookie bị trộm vì thế đi trọn đường:
 * gắn authenticator CỦA KẺ TRỘM → step-up → mở két. Docblock của `step-up.guard.ts` đã tự
 * viết ra đúng chuỗi bốn bước ấy khi giải thích vì sao step-up phải mặc-định-đóng; bước
 * `totp/enroll` là bước duy nhất trong chuỗi chưa ai đóng.
 *
 * Từ nay cửa đó đòi mật khẩu hiện tại. Đây là mẫu "sudo mode" quen thuộc: cái quyền đang
 * được cấp không phải quyền đọc một trang, mà là quyền QUYẾT ĐỊNH ai giữ chìa khóa thứ hai
 * của tài khoản này về sau.
 *
 * ===== VÌ SAO CÓ NGOẠI LỆ, VÀ VÌ SAO NGOẠI LỆ PHẢI CÓ HẠN =====
 *
 * Luồng đăng nhập bắt buộc cài 2 lớp (`totp_login_required`) đưa người dùng thẳng từ ô mật
 * khẩu sang màn quét QR. Hỏi lại mật khẩu ở đó là hỏi lại thứ vừa được gõ xong, và phiên
 * `totp_pending` chưa mở được gì ngoài ba route của chính luồng đăng nhập.
 *
 * Nhưng "phiên còn chờ" không tự hết. Người dùng bỏ dở giữa chừng, đứng dậy đi họp, để máy
 * mở — cái cửa ấy đứng đó tới khi phiên hết hạn tuyệt đối (12 giờ). Nên ngoại lệ tính theo
 * TUỔI CỦA PHIÊN, và hết hạn sớm hơn nhiều: đây là tham số đó.
 */
INSERT INTO system_config (key, value, description) VALUES
  ('totp.enroll_reauth_minutes', '15',
   'Cài 2 lớp trong luồng đăng nhập bắt buộc thì được miễn gõ lại mật khẩu trong bao nhiêu phút kể từ lúc phiên được tạo. Quá hạn, hoặc cài từ một phiên đã đăng nhập thường, đều phải gõ mật khẩu hiện tại')
ON CONFLICT (key) DO NOTHING;
