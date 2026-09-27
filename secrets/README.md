# secrets/ — bí mật dạng file (AD-11, NFR-02)

Ba file dưới đây KHÔNG bao giờ commit (đã có trong .gitignore) và KHÔNG nằm trong env.

| File | Sinh bằng | Ghi chú |
| --- | --- | --- |
| `master_key` | `echo "1=$(openssl rand -hex 32)" > secrets/master_key` | Chùm chìa envelope. Mỗi dòng `<version>=<64 hex>`; version lớn nhất là chìa hiện hành. **In giấy, 2 phong bì, 2 người giữ.** |
| `password_pepper` | `openssl rand -hex 32 > secrets/password_pepper` | Pepper Argon2id. Đổi pepper = mọi mật khẩu cũ hỏng → chỉ đổi khi reset toàn bộ. |
| `smtp_password` | `printf '%s' 'mat-khau-smtp' > secrets/smtp_password` | Dev để file rỗng (mailpit không auth). |

## Xoay chìa (key rotation) — khi nghi chìa đã lộ

Không xoay theo lịch (IMS là hệ nội bộ). Xoay khi có một trong ba chuyện: file `secrets/` hoặc
bản sao lưu của máy chủ bị sao chép ra ngoài; một bản dump DB bị mang về máy khác; người từng có
quyền vào máy chủ nghỉ việc.

Hai nơi dùng chùm chìa này: két sắt (`secret`) và **khoá TOTP của mọi người dùng**
(`users.totp_*`). Xoá nhầm một chìa còn đang dùng thì mất cả hai, kể cả trong bản sao lưu, và
không ai đăng nhập hai lớp được nữa. Vì vậy API **từ chối khởi động** nếu file thiếu một chìa mà
dữ liệu còn cần.

1. Thêm dòng mới vào `master_key`, **giữ nguyên dòng cũ**:
   `echo "2=$(openssl rand -hex 32)" >> secrets/master_key`
2. Khởi động lại: `docker compose restart api worker`. Từ đây bản ghi mới dùng chìa 2.
3. Bọc lại dữ liệu cũ sang chìa 2 (chạy lại được, bị ngắt thì chạy lại là đi tiếp):
   `docker compose exec api node dist/ops/rewrap.main.js`
4. Kiểm: `docker compose exec api node dist/ops/rewrap.main.js --check` phải in
   *"Không còn bản ghi nào ở chìa cũ"*.
5. Chạy một lượt sao lưu mới (`ops/backup-nightly.sh`). Bản sao lưu **cũ** vẫn cần chìa 1, nên
   phong bì chìa 1 giữ lại cho tới khi mọi bản sao lưu cũ hết hạn giữ (mặc định 30 ngày).
6. In chìa mới ra giấy, làm lại hai phong bì (RUNBOOK mục C). Sau 30 ngày mới bỏ dòng `1=…` khỏi
   file và huỷ phong bì chìa 1.

`key_version` nằm trong AAD của AES-GCM và `MasterKeyRing` tra chìa theo version — đừng "dọn" nó.

## Khôi phục

Bản sao lưu (`ops/backup-nightly.sh`) KHÔNG kèm master key và pepper (NFR-02); cả hai nằm trong
phong bì niêm phong. Diễn tập khôi phục mỗi quý: bê dump sang VM trắng + chìa gõ từ phong bì →
giải mã được một secret thử (`ops/restore-drill.sh`, xem `docs/RUNBOOK-4.3-dong-dot-1.md` mục E).
