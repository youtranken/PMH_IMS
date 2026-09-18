# secrets/ — bí mật dạng file (AD-11, NFR-02)

Ba file dưới đây KHÔNG bao giờ commit (đã có trong .gitignore) và KHÔNG nằm trong env.

| File | Sinh bằng | Ghi chú |
| --- | --- | --- |
| `master_key` | `echo "1=$(openssl rand -hex 32)" > secrets/master_key` | Chùm chìa envelope. Mỗi dòng `<version>=<64 hex>`; version lớn nhất là chìa hiện hành. **In giấy, 2 phong bì, 2 người giữ.** |
| `password_pepper` | `openssl rand -hex 32 > secrets/password_pepper` | Pepper Argon2id. Đổi pepper = mọi mật khẩu cũ hỏng → chỉ đổi khi reset toàn bộ. |
| `smtp_password` | `printf '%s' 'mat-khau-smtp' > secrets/smtp_password` | Dev để file rỗng (mailpit không auth). |

## Xoay chìa (key rotation) — thủ tục PHÁ KÍNH, không phải lịch định kỳ

> ### Đây là một lựa chọn có chủ ý, không phải việc bỏ dở
>
> **Quyết định của chủ dự án, 18/09/2026: KHÔNG xoay chìa theo lịch, và chưa dựng job xoay.**
> IMS là hệ nội bộ, không mở ra internet; xoay định kỳ cho một hệ như vậy tốn công mà gần như
> không đổi lại được gì. Ai đọc mục này về sau đừng coi cái job còn thiếu là nợ kỹ thuật cần
> trả gấp — nó là thứ cố ý chưa làm.
>
> **Nhưng cái làm chìa lộ không đi qua internet.** Ba đường thật: file `.env`/`secrets/` trên
> máy chủ và mọi bản sao lưu của máy đó; một bản dump DB ai đó copy về máy để thử; và người
> từng có quyền vào máy chủ rồi nghỉ việc — bản chìa họ đã thấy thì không thu lại được. Nếu
> một trong ba việc đó xảy ra thì **xoay chìa là việc phải làm, và lúc đó bước đầu tiên là
> DỰNG CÁI JOB**, chứ không phải chạy quy trình dưới đây.
>
> Hàm `rewrap()` (`api/src/common/crypto/envelope.service.ts`) mã lại MỘT bản ghi sang chìa mới
> và đã có bài kiểm đầy đủ — nhưng **chưa có lệnh/job nào gọi nó** (rà 17/09/2026: grep toàn
> `api/src` và `ops/` chỉ ra đúng dòng định nghĩa). Nghĩa là bước 3 dưới đây **hiện không chạy
> được**, và **TUYỆT ĐỐI KHÔNG ĐƯỢC XOÁ DÒNG CHÌA CŨ**.
>
> Xoá nhầm thì mất không lấy lại được, và mất nhiều hơn người ta tưởng:
> - mọi ngăn cũ trả lỗi 500 khi mở (`MasterKeyRing.get(1)` ném);
> - ciphertext trong **bản sao lưu** cũng không còn chìa nào mở được — backup không cứu được;
> - `users.totp_key_version` (migration 0002) dùng CHUNG chùm chìa này, nên **không ai step-up
>   được nữa** — kể cả người cần vào để sửa.
>
> ### Và bộ khung `key_version` thì GIỮ NGUYÊN, đừng dọn
>
> Nhìn từ xa nó dễ trông như đồ thừa của một tính năng chưa làm. Không phải: `key_version` nằm
> trong AAD của AES-GCM và `MasterKeyRing` tra chìa theo version, nên gỡ nó ra là hỏng luôn
> đường giải mã bình thường — không liên quan gì tới xoay chìa. Giữ nó cũng có nghĩa là ngày
> cần xoay thật, chỗ còn thiếu chỉ là cái job, không phải dựng lại từ đầu.

1. Thêm dòng mới vào `master_key`: `2=<hex mới>` — **giữ nguyên dòng cũ**, nếu không dữ liệu cũ không giải được.
2. Restart api/worker. Từ đây bản ghi MỚI dùng chìa 2; bản ghi cũ vẫn ở chìa 1 và vẫn đọc được.
3. ~~Chạy job xoay~~ — **chưa có**. Cho tới khi có, việc xoay chìa chỉ đạt được một nửa: chìa
   mới đã dùng cho dữ liệu mới, nhưng **chìa cũ vẫn còn giá trị** với dữ liệu cũ. Nếu lý do
   xoay là *nghi chìa cũ đã lộ* thì mối nguy VẪN CÒN — phải coi như chưa xử lý xong.
4. Bước xoá dòng cũ chỉ được làm khi đếm ra **0 bản ghi** ở version cũ. Đếm bằng:

   ```sql
   -- Ngăn trong két, theo từng version chìa.
   -- KHÔNG lọc `revoked_at IS NULL`: ngăn đã thu hồi VẪN giữ nguyên ciphertext
   -- (xem `VaultService.revoke` — "mật khẩu cũ vẫn cần tra khi điều tra sự cố").
   -- Lọc chúng ra là đếm thiếu, xoá chìa, và mất vĩnh viễn toàn bộ mật khẩu lịch sử
   -- — kể cả trong bản sao lưu.
   SELECT key_version, revoked_at IS NULL AS con_dung, count(*)
     FROM secret GROUP BY 1, 2 ORDER BY 1, 2;
   -- Khoá TOTP của tài khoản — cùng chùm chìa, hay bị quên
   SELECT totp_key_version, count(*) FROM users WHERE totp_key_version IS NOT NULL GROUP BY 1;
   ```

   Cả hai câu phải không còn dòng nào mang version cũ.

## Khôi phục

Backup Postgres KHÔNG kèm master key (NFR-02). Restore drill mỗi quý phải kiểm: bê dump sang máy
khác + chìa từ phong bì → giải mã được một bản ghi mẫu.
