# Runbook — Story 4.3: Đóng Đợt 1

Đây là story DUY NHẤT của Đợt 1 mà máy không làm thay người được. Ba việc dưới đây cần
tay người: mở phong bì niêm phong, đứng trước một máy sạch, và bấm nút deploy lên LAN thật.

Ước lượng: **nửa ngày**, 2 người (một SA + một người giữ phong bì thứ hai).
Làm theo thứ tự A → B → C. Mỗi phần có ô ghi biên bản ở cuối file.

Chuẩn bị trước khi bắt đầu:

- [ ] File Excel 300 thiết bị thật, đã đối chiếu với `docs/mau-du-lieu/mau-thiet-bi.xlsx`
- [ ] Một máy sạch (hoặc một VM mới) có docker, **không** phải máy đang chạy IMS
- [ ] NAS đã mount được từ máy chủ IMS
- [ ] Cert wildcard `*.pmh.com.vn` (file `.crt` + `.key`)
- [ ] Hai phong bì trắng + bút + máy in

---

## A. Chìa và bản sao lưu

### A1. Sinh master key thật cho production

Chìa hiện tại trong `secrets/master_key` là chìa **dev**. Production phải có chìa riêng,
sinh trên chính máy chủ prod, và không bao giờ đi qua chat/email/git.

```bash
# Trên MÁY CHỦ PROD
openssl rand -hex 32
```

Ghi kết quả thành đúng một dòng `1=<64 ký tự hex>` vào `secrets/master_key`.

> Vì sao bắt đầu từ version 1 chứ không phải 2: version là số thứ tự của chìa, không phải
> phiên bản phần mềm. Xoay chìa lần đầu sau này sẽ thêm dòng `2=…`, và dòng `1=…` **ở lại**
> để còn giải được dữ liệu chưa xoay. Xoá dòng cũ = mất vĩnh viễn mọi thứ mã bằng nó.

### A2. In chìa ra giấy, hai phong bì, hai người giữ (AR-9)

```bash
cat secrets/master_key   # in ra màn hình, chụp lại bằng máy in, KHÔNG lưu file
```

- In **2 bản**. Mỗi bản ghi thêm: ngày in, tên hệ thống (IMS), và câu
  *"Chìa giải mã két sắt IMS — không sao chép, không chụp ảnh"*.
- Bỏ mỗi bản vào một phong bì, dán, **ký đè lên mép dán** (chữ ký vắt qua mép giấy: mở trộm
  là thấy).
- Hai người khác nhau giữ, ở hai chỗ khác nhau. Không ai giữ cả hai.

> Vì sao hai bản chứ không phải một: một bản thì mất là hết. Vì sao không phải năm: mỗi bản
> thêm là một chỗ nữa có thể lộ. Hai là số nhỏ nhất còn chịu được một tai nạn.

### A3. Bật sao lưu hằng đêm sang NAS

```bash
# Trên MÁY CHỦ PROD — thử chạy tay một lần trước
bash ops/backup-nightly.sh /mnt/nas/ims-backup

# Chạy được rồi thì đặt cron 01:30 mỗi đêm
crontab -e
# 30 1 * * * cd /opt/ims && bash ops/backup-nightly.sh /mnt/nas/ims-backup >> /var/log/ims-backup.log 2>&1
```

Script sẽ **dừng** nếu thấy file master key nằm trong thư mục sao lưu. Đó là cố ý: dump chứa
ciphertext của két; để chìa nằm cạnh nó thì ai lấy được NAS là mở được hết, và cả lớp mã hóa
thành ra trang trí.

- [ ] Chạy tay thành công, file `.gz` xuất hiện trên NAS
- [ ] Cron đã đặt
- [ ] Kiểm lại: `ls /mnt/nas/ims-backup` **không** có file nào tên `master_key*`

---

## B. Diễn tập khôi phục

Mục đích không phải "chứng minh backup chạy". Mục đích là **chứng minh chìa in trên giấy mở
được dữ liệu trong backup** — thứ chỉ biết được khi thử thật.

### B1. Cất một secret THỬ (làm trên prod, trước khi backup chạy)

Vào IMS → một thiết bị bất kỳ → tab **Két sắt** → **Cất secret**:

| Trường | Giá trị |
| --- | --- |
| Tên gọi | `drill 2026-08` (bắt buộc chứa chữ **drill**) |
| Loại | Khác |
| Giá trị | một chuỗi tự nghĩ, ví dụ `DrillOK#2026-08-23` |

Ghi chuỗi đó vào biên bản ở cuối file này. Đây là chuỗi sẽ đem so ở bước B3.

> Nhãn phải chứa "drill" vì script diễn tập **chỉ** mở được secret có nhãn như vậy. Két thật
> không mở được bằng đường đó — nếu không thì chính buổi diễn tập đã là cửa hậu xuất két
> (FR-026).

Đợi cron chạy, hoặc chạy tay `bash ops/backup-nightly.sh /mnt/nas/ims-backup`.

### B2. Khôi phục trên máy sạch

Chép repo + file dump sang máy sạch (dump chép được; **chìa thì không** — chìa đi bằng phong bì).

```bash
# Trên MÁY SẠCH
cp .env.example .env       # điền POSTGRES_USER/PASSWORD/REDIS_PASSWORD tuỳ ý, đây là máy tạm
bash ops/restore-drill.sh /duong/dan/ims-20260823-013000.sql.gz
```

Script sẽ hỏi `MAY SACH` để xác nhận (nó xoá sạch volume — hỏi để không ai chạy nhầm trên
máy thật), rồi dừng ở bước 3 chờ **người giữ phong bì gõ chìa từ bản giấy**.

Gõ tay, không copy-paste, không cắm USB. Cái đang được diễn tập chính là *"bản giấy này có
thật sự dùng được không"* — nếu chìa vẫn nằm đâu đó trong ổ cứng thì hôm ổ cứng chết mới
biết là không có chìa.

### B3. Điều kiện ĐỖ

Bước 5 in ra chuỗi. **Khớp với chuỗi ghi ở B1 → ĐỖ.**

Lệch hoặc báo lỗi → **HỎNG**. Đừng sửa vội; ghi lại nguyên trạng rồi truy:

| Triệu chứng | Nguyên nhân hay gặp |
| --- | --- |
| `Không có chìa version N trong bản giấy` | Bản sao lưu cũ hơn lần xoay chìa — phong bì thiếu dòng cũ |
| `Giải mã KHÔNG thành công` | Gõ nhầm một ký tự hex; gõ lại chậm, đọc từng cặp |
| `không có secret nào để giải` | Backup chạy TRƯỚC khi cất secret thử — cất lại rồi backup lại |

- [ ] Drill ĐỖ, chuỗi khớp
- [ ] Phong bì đã niêm phong lại, ký đè mép dán lần nữa
- [ ] Ghi ngày diễn tập kế tiếp (6 tháng sau) vào lịch

### B4. Dọn máy diễn tập

```bash
docker compose down -v
shred -u secrets/master_key 2>/dev/null || rm -f secrets/master_key
```

Máy sạch giờ **không được** còn chìa. Nếu là VM thì xoá luôn VM.

---

## C. Dữ liệu thật và deploy LAN

### C1. Import 300 thiết bị

Dùng đúng luồng của story 2.6 — không có đường nhập thẳng vào DB.

IMS → **Thiết bị** → **Nhập Excel** → chọn file → xem bảng đối chiếu → **Xác nhận ghi**.

Bảng đối chiếu hiện trước khi ghi: bao nhiêu dòng tạo mới, cập nhật, bỏ qua, lỗi. Đọc kỹ
phần **lỗi** trước khi bấm xác nhận — sửa trong file Excel rồi nhập lại, đừng sửa tay sau
khi đã ghi.

Đối chiếu số liệu (AR-10):

| Kiểm | Cách |
| --- | --- |
| Tổng số thiết bị | Đếm dòng file Excel = số ở màn Thiết bị |
| Theo site | Lọc từng site, so với subtotal trong Excel |
| Theo loại | Lọc từng loại, so với subtotal |
| Serial trùng | Màn nhập báo ở cột lỗi — phải bằng 0 |

- [ ] Import xong, 0 dòng lỗi
- [ ] Bốn phép đối chiếu trên đều khớp

### C2. Deploy LAN qua HTTPS 443

```bash
# Cert wildcard vào ops/certs/ (tên file đúng như nginx.conf đang trỏ)
cp /duong/dan/wildcard.pmh.com.vn.crt ops/certs/ims.crt
cp /duong/dan/wildcard.pmh.com.vn.key ops/certs/ims.key
chmod 600 ops/certs/ims.key

docker compose up -d --build
docker compose ps        # cả 5 service phải healthy
```

DNS nội bộ: trỏ `ims.pmh.com.vn` về IP LAN của máy chủ.

> SMTP thật chỉ bật ở prod (quyết định của anh Thuận). Dev/CI vẫn dùng mailpit — đừng chép
> `secrets/smtp_password` thật sang máy dev.

Kiểm từ **máy IT của cả 3 site**:

- [ ] Site 1 — mở `https://ims.pmh.com.vn`, đăng nhập được, không cảnh báo cert
- [ ] Site 2 — như trên
- [ ] Site 3 — như trên
- [ ] Thử trên điện thoại (390px): mở một thiết bị, đọc được hồ sơ

### C3. Tạo và nhận tài khoản SA

Chạy `docker compose exec api node dist/ops/seed-sa.main.js` đúng một lần. Script in mật khẩu
tạm ngẫu nhiên của từng SA ra màn hình **một lần duy nhất**: chép ra giấy, trao tận tay, không
gửi qua chat/email. Script từ chối chạy nếu hệ thống đã có SA. Đăng nhập lần đầu buộc đổi mật
khẩu và cài TOTP — **làm ngay**, đừng để sang hôm sau.

- [ ] `sa@pmh.com.vn` đã đổi mật khẩu + cài TOTP
- [ ] `caothuan@pmh.com.vn` đã đổi mật khẩu + cài TOTP

---

## Biên bản diễn tập khôi phục

Điền bản này, in ra, ký, kẹp vào hồ sơ ISO cùng chỗ với các phiếu khác.

```
BIÊN BẢN DIỄN TẬP KHÔI PHỤC HỆ THỐNG IMS

Ngày diễn tập      : ____/____/________        Bắt đầu: ____:____  Kết thúc: ____:____
Người chủ trì (SA) : ______________________________
Người giữ phong bì : ______________________________

Bản sao lưu dùng   : ims-________________.sql.gz     Kích thước: __________
Máy diễn tập       : ______________________________  (KHÔNG phải máy chạy IMS)

Secret thử         : nhãn ..........................  id ..............................
Chuỗi đã cất       : ______________________________
Chuỗi giải ra được : ______________________________
Chìa dùng (version): ______

KẾT QUẢ:   [ ] ĐỖ — hai chuỗi khớp        [ ] HỎNG — ghi rõ bên dưới

Ghi chú / sự cố gặp phải:
_________________________________________________________________________
_________________________________________________________________________

Sau diễn tập:
[ ] Phong bì đã niêm phong lại, ký đè mép dán
[ ] Máy diễn tập đã xoá chìa và xoá volume
[ ] Ngày diễn tập kế tiếp: ____/____/________  (6 tháng)

Chữ ký SA: ______________________   Chữ ký người giữ phong bì: ______________________
```

---

## Sau khi xong cả A, B, C

1. Đánh dấu `4-3-đóng-đợt-1-dữ-liệu-thật-và-diễn-tập-khôi-phục: done` và `epic-4: done`
   trong `_bmad-output/implementation-artifacts/sprint-status.yaml`.
2. Thêm mục **"Epic 4 đã đóng góp gì"** vào `docs/EPIC-MAP.md`.
3. Chạy `graphify update . && graphify cluster-only . && graphify label . --missing-only`.
