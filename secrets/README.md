# secrets/ — bí mật dạng file (AD-11, NFR-02)

Ba file dưới đây KHÔNG bao giờ commit (đã có trong .gitignore) và KHÔNG nằm trong env.

| File | Sinh bằng | Ghi chú |
| --- | --- | --- |
| `master_key` | `echo "1=$(openssl rand -hex 32)" > secrets/master_key` | Chùm chìa envelope. Mỗi dòng `<version>=<64 hex>`; version lớn nhất là chìa hiện hành. **In giấy, 2 phong bì, 2 người giữ.** |
| `password_pepper` | `openssl rand -hex 32 > secrets/password_pepper` | Pepper Argon2id. Đổi pepper = mọi mật khẩu cũ hỏng → chỉ đổi khi reset toàn bộ. |
| `smtp_password` | `printf '%s' 'mat-khau-smtp' > secrets/smtp_password` | Dev để file rỗng (mailpit không auth). |

## Xoay chìa (key rotation)

1. Thêm dòng mới vào `master_key`: `2=<hex mới>` — **giữ nguyên dòng cũ**, nếu không dữ liệu cũ không giải được.
2. Restart api/worker.
3. Chạy job xoay (Epic 4) để `rewrap` toàn bộ bản ghi lên version mới.
4. Chỉ khi không còn bản ghi nào ở version cũ mới được xóa dòng cũ.

## Khôi phục

Backup Postgres KHÔNG kèm master key (NFR-02). Restore drill mỗi quý phải kiểm: bê dump sang máy
khác + chìa từ phong bì → giải mã được một bản ghi mẫu.
