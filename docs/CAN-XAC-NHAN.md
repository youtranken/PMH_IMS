# Những chỗ tôi tự quyết — cần anh xem lại

## Tình hình đến 23/08/2026

Phạm vi anh giao (Epic 3 → 4.1/4.2 → 5 → 6 → 7) đã **xong hết**.

| Epic | Trạng thái |
| --- | --- |
| 1 · Nền tảng & Đăng nhập | done |
| 2 · Kho thiết bị | done |
| 3 · Phần mềm & Cảnh báo hết hạn | done |
| 4 · Két sắt | 4.1 + 4.2 done · **4.3 chờ anh** |
| 5 · Quản lý IP & NAT | done |
| 6 · Break-glass & Phê duyệt | done |
| 7 · Dashboard sếp | done |
| 8 · Phiếu ISO · 9 · Sự cố | **chờ 8 mẫu phiếu của anh** |

Số liệu: **459 test API · 80 test web · 143 E2E** xanh trên docker thật. 25 migration chạy
sạch trên DB trắng. `dependency-cruiser` 0 vi phạm. Mỗi epic đóng đều qua `/code-review high`
và sửa hết finding — tổng cộng **45 finding** qua 6 lần review, ghi đủ trong `docs/EPIC-MAP.md`.

## Hai việc cần anh

**1. Story 4.3 — đóng Đợt 1.** Máy không làm thay được: mở phong bì niêm phong, đứng trước
một máy sạch, bấm deploy lên LAN thật. Đường đi từng bước + biên bản để in và ký nằm ở
**`docs/RUNBOOK-4.3-dong-dot-1.md`**. Ước lượng nửa ngày, cần 2 người. Script sao lưu và diễn
tập khôi phục đã viết và **đã chạy thử**.

Anh chuẩn bị trước: file Excel 300 thiết bị thật, một máy sạch (hoặc VM mới), NAS mount được,
cert wildcard `*.pmh.com.vn`, hai phong bì trắng.

**2. Epic 8/9 — 8 mẫu phiếu ISO.** Đặt vào `docs/mau-phieu-iso/`: 0204, 0205, 0208, 0213,
0207, 0209, 0210, 0214. Hiện mới có mockup của 0203 và 0206.

## Sáu chỗ tôi tự quyết, mời anh duyệt

Đọc phần dưới. Sai chỗ nào anh nói, sửa bây giờ vẫn còn rẻ.


> Anh đã đồng ý (2026-08-23): gặp chỗ AC chưa chốt thì **tự quyết theo mặc định an toàn rồi
> ghi vào đây**, thay vì dừng chờ. File này là danh sách để anh đọc buổi sáng: chỗ nào sai
> thì nói, tôi sửa — sửa sớm rẻ hơn nhiều so với để cả đêm không ai làm gì.
>
> Mỗi mục ghi đủ: **quyết gì · vì sao · sửa lại tốn bao nhiêu**.

---

## Đã chốt cùng anh (không cần xem lại)

| Ngày | Việc | Chốt |
| --- | --- | --- |
| 2026-08-22 | Danh mục seed sẵn | Chỉ seed 12 loại thiết bị. Site/tủ/NCC để trống, anh điền file mẫu rồi import |
| 2026-08-23 | **Xóa hẳn bản ghi nhập nhầm** (open item PRD) | **KHÔNG xóa hẳn.** Bản ghi nhập nhầm được đánh dấu và ẩn khỏi mọi danh sách, vẫn tra cứu được, vẫn còn vết ai nhập ai ẩn. Áp cho IP (Epic 5) và mọi module sau |
| 2026-08-23 | Phạm vi đêm 23/08 | Epic 3 → 4.1/4.2 → 5 → 6 → 7. **Dừng trước story 4.3** (cần anh làm tay: diễn tập khôi phục, phong bì niêm phong, dữ liệu thật, deploy prod) và **dừng trước Epic 8/9** (chờ 8 mẫu phiếu ISO) |

---

## Đang chờ anh — story 4.3 (không phải chờ quyết định, mà chờ TAY người)

Code của Epic 4 xong hết: két sắt (4.1) và mở két bằng TOTP (4.2) đã chạy, đã test, đã commit.
Story 4.3 là ba việc máy không làm thay được: **mở phong bì niêm phong**, **đứng trước một máy
sạch**, và **bấm deploy lên LAN thật**.

Tôi đã viết sẵn đường đi từng bước, kể cả biên bản để in và ký:
**`docs/RUNBOOK-4.3-dong-dot-1.md`** — ước lượng nửa ngày, cần 2 người (anh + một người nữa
giữ phong bì thứ hai).

Kèm theo đó là hai script đã viết và một override compose:

| File | Làm gì |
| --- | --- |
| `ops/backup-nightly.sh` | pg_dump hằng đêm sang NAS. Tự **dừng** nếu thấy master key nằm cùng thư mục — chìa và ổ khóa phải tách máy |
| `ops/restore-drill.sh` | Dựng stack trắng, nạp dump, rồi dừng chờ người giữ phong bì **gõ chìa từ bản giấy** |
| `docker-compose.override.drill.yml` | Mount script giải mã thử — cố ý KHÔNG nằm trong image production |

Cần anh chuẩn bị trước: file Excel 300 thiết bị thật, một máy sạch (hoặc VM mới), NAS mount
được, cert wildcard `*.pmh.com.vn`, hai phong bì trắng.

---

## Cần anh xác nhận

### 1. Hợp đồng ISP: bảng riêng, không phải một "loại phần mềm" — story 3.1/3.3

**Quyết:** loại hồ sơ phần mềm gồm `License · SSL · Tên miền · Hợp đồng bảo trì · Khác`.
**Bỏ** loại "hợp đồng ISP" khỏi danh sách này; đường truyền ISP có **bảng và màn riêng**
(story 3.3) với đủ nhà mạng, băng thông, IP WAN, thiết bị Draytek, hotline, số hợp đồng.

**Vì sao:** AC 3.1 liệt kê "hợp đồng ISP" là một loại phần mềm, nhưng AC 3.3 lại đòi hồ sơ ISP
có cả chục trường vận hành không nhét vừa bảng `software`. Để cả hai thì cùng một hợp đồng ISP
khai được ở hai nơi — đúng kiểu dữ liệu lệch nhau sau vài tháng. Hồ sơ ISP ở 3.3 **đã có**
ngày bắt đầu/kết thúc và số hợp đồng, nên nó chính là hợp đồng, không cần bản sao.

**Sửa lại tốn bao nhiêu:** nhỏ. Thêm lại `isp_contract` vào danh sách loại là một migration
đổi `CHECK` + một dòng trong `software-rules.ts`. Chưa có dữ liệu thật nên không phải chuyển gì.

### 2. Trạng thái hồ sơ phần mềm — story 3.1

**Quyết:** ba trạng thái `Đang dùng · Hết hạn, không gia hạn · Đã bỏ`. AC không nêu danh sách
trạng thái, nhưng cỗ máy cảnh báo (3.4) cần biết cái nào **thôi không nhắc nữa** — nếu không thì
mỗi license cũ đã bỏ vẫn nhắc mãi và người ta sẽ tắt luôn cảnh báo.

**Sửa lại tốn bao nhiêu:** nhỏ, một migration đổi `CHECK` + nhãn i18n.

### 3. Địa chỉ IP: chỉ IPv4, và dải hẹp hơn /8 — story 5.1

**Quyết:** hệ thống chỉ nhận IPv4. Gõ `fe80::/64` bị từ chối thẳng kèm lời giải thích, không
nhận vào rồi quản nửa vời. Dải cũng phải hẹp hơn hoặc bằng /8 — gõ `10.0.0.0/7` bị chặn kèm
câu hỏi "có phải gõ nhầm /24 không?".

**Vì sao:** AC nói LAN của PMH là 172.16.x/24, chưa có IPv6 ở đâu. Nhận IPv6 nửa vời còn tệ
hơn từ chối: người ta khai vào rồi tưởng hệ thống quản được, tới lúc cần tra thì mới biết là
không. Còn dải rộng hơn /8 (16 triệu địa chỉ) thì màn "IP trống còn lại" phải dựng danh sách
đó ra — và không ai khai dải /7 trong một mạng văn phòng.

**Sửa lại tốn bao nhiêu:** IPv6 thì trung bình — số học địa chỉ phải viết lại (`ip-rules.ts`),
nhưng bảng đã dùng kiểu `inet`/`cidr` của Postgres nên DB không phải đổi, chỉ bỏ hai ràng buộc
`family(...) = 4`. Nới ngưỡng /8 thì chỉ là một hằng số.

### 4. Vòng đời IP: bốn trạng thái — story 5.1/5.2

**Quyết:** `Trống · Đang cấp · Nghi chết · Đã thu hồi`, đúng theo state machine AC 5.2 khai.
Đổi trạng thái KHÔNG sửa trực tiếp được qua form (API trả lỗi `IP_STATUS_NEEDS_TRANSITION`) —
phải đi thao tác riêng, để cái máy trạng thái không chỉ là gợi ý.

**Sửa lại tốn bao nhiêu:** nhỏ, một migration đổi `CHECK` + nhãn i18n.

### 5. Break-glass dùng bảng `approval` chung, không có bảng `access_grant` riêng — story 6.3

**Quyết:** AC 6.3 viết "lưu bảng `access_grant` + history". Tôi dùng bảng `approval` +
`approval_history` của module duyệt dùng chung (story 6.1) thay cho một bảng riêng.

**Vì sao:** AD-6 nói thẳng — *"mọi luồng xin–duyệt dùng bảng `approval` chung + từ vựng state
đăng ký theo loại"*, và ARCHITECTURE-SPINE là luật chứ không phải gợi ý (CLAUDE.md). Đẻ thêm
`access_grant` là đúng thứ AD-6 sinh ra để chặn: mỗi tính năng một bảng duyệt riêng, rồi phiếu
ISO ở Epic 8 lại một bảng nữa. Mọi thứ AC đòi đều có đủ trong bảng chung: ai xin (`requester`),
lý do (`reason`), ai duyệt (`decided_by`), hết hạn (`expires_at`), và xem lúc nào (nằm ở
`audit_log` với `action = 'vault.secret.revealed'` kèm `grantId`).

**Sửa lại tốn bao nhiêu:** nếu anh vẫn muốn bảng riêng thì trung bình — một migration + đổi
`BreakGlassService`. Nhưng tôi khuyên không: Epic 8 sẽ cắm phiếu ISO vào đúng bộ máy này.

### 6. Nhật ký "xem lúc nào" nằm ở `audit_log`, không nằm trong bảng duyệt — story 6.3

**Quyết:** mỗi lần mở két ghi một dòng `audit_log` kèm `grantId` (grant nào cho phép lần xem
đó). Bảng `approval` chỉ giữ vòng đời của yêu cầu.

**Vì sao:** một grant 4 giờ có thể được dùng để xem nhiều secret nhiều lần. Nhét lượt xem vào
bảng duyệt thì hoặc phải đẻ thêm bảng con, hoặc phải nhồi một mảng vào `payload` — trong khi
`audit_log` đã là nơi trả lời "ai làm gì lúc nào" cho cả hệ thống (AD-9).

**Sửa lại tốn bao nhiêu:** nhỏ. Dashboard Epic 7 join hai bảng theo `grantId` là ra.

