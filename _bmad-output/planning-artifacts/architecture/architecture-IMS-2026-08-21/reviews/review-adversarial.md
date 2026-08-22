---
review: adversarial
target: ARCHITECTURE-SPINE.md (architecture-IT_QLMgmtIP-2026-08-21)
context: prd-IT_QLMgmtIP-2026-08-19/prd.md
lens: 'Tấn công spine như kẻ đối kháng: dựng các cặp unit tuân thủ đúng từng chữ mọi AD nhưng vẫn build vênh nhau'
date: 2026-08-21
verdict: 'Spine chắc ở trục an ninh (AD-4/8/9) nhưng cơ chế đọc-chéo giữa các module nghiệp vụ tự mâu thuẫn (AD-2 vs chính nó, AD-2 vs AD-3) và một loạt bảng/hành-động vô chủ — đủ để hai team tuân luật tuyệt đối mà vẫn không ghép được; phải vá trước khi tách epic.'
---

# Review đối kháng — ARCHITECTURE-SPINE QLMgmtIP

**Phương pháp:** với từng cặp module/epic có khả năng build độc lập, giả lập hai team đọc spine theo hai cách hiểu đều "đúng từng chữ", rồi kiểm tra lúc ghép có vênh không. Mỗi lỗ hổng = cặp unit + kịch bản vênh + AD đề xuất vá.

---

## LH-1 · CRITICAL — AD-2 tự mâu thuẫn: "gọi service module kia qua DI" vs "cấm import ngang cùng tầng nghiệp vụ"

**Cặp unit:** `devices` × `ipam` (FR-005 "IP đang giữ" / FR-016 "thiết bị giữ") — và lặp lại với `devices` × `vault` (FR-005 hiện secret theo quyền, AD-4 bắt buộc đi qua service vault, mà vault nằm CÙNG tầng nghiệp vụ với devices), `devices` × `software`, `incidents` × `devices`.

**Kịch bản vênh:** AD-2 viết liền hai câu: *"không import ngang trong cùng tầng nghiệp vụ"* rồi *"Cần dữ liệu chéo: gọi service công khai của module kia qua DI"*. Trong NestJS, inject service của module kia = import module kia — chính là import ngang.
- Team **ipam** đọc câu 1: devices không được phụ thuộc ipam → ipam không export gì, tự do đổi schema và chữ ký service.
- Team **devices** đọc câu 2: build `DevicesReadService` inject `IpamReadService`, khai `imports: [IpamModule]` — "gọi service công khai qua DI" đúng nguyên văn.

Cả hai đúng luật. Lúc ghép: hoặc devices vỡ lint cấm import ngang, hoặc trang chi tiết thiết bị (FR-005) không có cột IP/secret/license — tức FR chủ lực của F1 không build được bằng bất kỳ cách hợp lệ nào. Nghiêm trọng nhất ở vault: AD-4 ra lệnh *"mọi truy cập qua service vault"* trong khi AD-2 cấm devices import vault — hai AD bắt buộc và cấm cùng một hành vi.

**Chiều FK & ai tạo liên kết:** kể cả khi đọc được, không AD nào nói cột `device_id` nằm trên `ip_address` (ipam chủ) hay một bảng nối do devices tạo. AD-3 chỉ liệt kê bảng có sẵn — bảng nối mới `device_ip_link` không ai chủ, hai team đều "được phép" tạo. Nút "gán IP" trên trang thiết bị cũng không có đường ghi hợp lệ (devices không được ghi bảng ipam).

**AD vá (sửa AD-2 + bổ sung AD-13):**
1. Sửa AD-2 cho hết nhập nhằng — chọn một trong hai và viết chết:
   - *(khuyến nghị)* Import ngang tầng nghiệp vụ **chỉ được phép ở dạng `*-read.service` exported**, theo **ma trận chiều cho phép** liệt kê ngay trong AD (vd `devices→ipam.read, devices→software.read, devices→vault.meta, incidents→devices.read, sheets→devices.read`), kiểm tra không vòng bằng lint; ghi chéo tuyệt đối cấm.
   - Hoặc: cấm tuyệt đối kể cả DI; mọi màn hình tổng hợp (FR-005) do **frontend compose** qua nhiều API (`GET /ipam/ip-addresses?deviceId=`), backend không có endpoint aggregate chéo module.
2. AD-13 mới — quan hệ chéo module: cột FK nằm ở bảng phía "nhiều" và thuộc module chủ bảng đó (`ip_address.device_id` do ipam sở hữu và ghi); hành động tạo/gỡ liên kết = endpoint của module chủ bảng; UI trang thiết bị gọi thẳng endpoint đó.

---

## LH-2 · CRITICAL — AD-3 "Module khác chỉ đọc" hợp pháp hóa đúng điều AD-2 cấm; dashboard là nạn nhân đầu tiên

**Cặp unit:** `dashboard` × (`incidents`, `approvals`, `expiry`, `audit`).

**Kịch bản vênh:** AD-3 kết bằng *"Module khác chỉ đọc (trừ AD-4)"* — đọc nguyên văn là: SELECT bảng module khác thì hợp lệ. AD-2 lại nói *"cấm SELECT thẳng bảng module khác"*. Graph trong spine cho dashboard chỉ phụ thuộc `auth & common & database` — không có cạnh nào tới incidents/approvals/expiry.
- Team **dashboard** cần FR-027 (sắp hết hạn, sự cố tuần, break-glass tuần): họ trích AD-3, viết SQL qua `common/sql.ts` SELECT thẳng `incident`, `approval`, `audit_log` — "chỉ đọc" nên thỏa AD-3, không import module nào nên thỏa luôn "không import ngang". Đúng từng chữ.
- Team **incidents** tin schema là tài sản riêng (AD-3 ownership), đổi tên cột thoải mái → dashboard vỡ ngầm lúc runtime, không compiler/lint nào bắt.
- Còn nếu dashboard tuân AD-2 (cấm SELECT thẳng) thì với graph hiện tại nó **không có bất kỳ đường hợp lệ nào** lấy dữ liệu — FR-027 không build được.

**AD vá:**
1. Sửa câu cuối AD-3 thành: *"Module khác chỉ đọc **qua service công khai của module chủ** — không bao giờ qua SQL trực tiếp"* (đồng bộ với AD-2 đã vá ở LH-1).
2. AD riêng cho dashboard: dashboard = read-model tổng hợp; hoặc (a) gọi read-service các module theo ma trận LH-1, hoặc (b) chỉ được SELECT qua **SQL VIEW do module chủ định nghĩa trong migration của chính họ** (view = hợp đồng công khai, đổi view phải giữ tương thích). Chọn một, viết vào AD, và sửa mermaid graph cho khớp (thêm cạnh dashboard → các nguồn).

---

## LH-3 · HIGH — AD-7 "engine quét bảng đăng ký" vs AD-2 cấm SELECT chéo, và vs AD-4 nếu hạn nằm trên bảng secret

**Cặp unit:** `expiry` × `software` (và `expiry` × `vault`).

**Kịch bản vênh:** AD-7 định contract đăng ký `(loại, bảng, cột start/end)` và *"engine quét"*.
- Team **software** đăng ký `('license','software','start_date','end_date')` rồi chờ engine tự SELECT bảng `software`. Đúng nguyên văn AD-7.
- Team **expiry** đọc AD-2: *"cấm SELECT thẳng bảng module khác"* — không thấy ngoại lệ nào cho tầng nền → họ build engine nhận **callback** `fetchDueRecords()` thay vì tên bảng. Cũng đúng nguyên văn.

Hai contract đăng ký không khớp → tích hợp fail dù không ai sai luật. Nhánh chết người hơn: FR-036 đưa license key/valid key vào vault; nếu một dev đặt cột `expires_at` ngay trên bảng `secret` (hạn của valid key, hạn đổi mật khẩu định kỳ) rồi đăng ký nó theo AD-7 → engine quét bảng `secret` → vi phạm thẳng AD-4 (*"không module nào SELECT — kể cả đọc"*), và không AD nào hiện chặn kịch bản này.

**AD vá:** sửa AD-7: (a) tuyên bố rõ **ngoại lệ có chủ đích**: expiry được SELECT read-only đúng các cột đã đăng ký của bảng nghiệp vụ — ghi ngoại lệ này vào cả AD-2; hoặc chuyển contract sang view/read-query do module chủ cung cấp. (b) Bổ vào AD-4 một câu: *"cấm đăng ký bảng `secret` vào expiry; mọi thuộc tính có hạn liên quan secret phải nằm ở bảng metadata ngoài secret (vd cột trên `software`)"*.

---

## LH-4 · HIGH — Nút "đã gia hạn" (FR-014) không có đường ghi hợp lệ; bảng lịch sử gia hạn vô chủ

**Cặp unit:** `expiry` × `devices`/`software`.

**Kịch bản vênh:** FR-014: màn Expiry có thao tác "đã gia hạn nhập end mới, **giữ lịch sử các lần gia hạn**". Cột end nằm trên bảng của devices/software (AD-3), expiry không được ghi bảng đó và không được import module nghiệp vụ (AD-7).
- Team **expiry** không có đường hợp lệ update end → họ tạo bảng `renewal_history` riêng (AD-3 không cấm — bảng mới không nằm trong danh sách chủ) và chỉ ghi lịch sử, kỳ vọng "ai đó" update end thật.
- Team **software** build `PATCH /software/:id` cập nhật end nhưng không ghi lịch sử (không biết `renewal_history` tồn tại).

Kết quả: end mới và lịch sử gia hạn tách đôi, lệch nhau — hoặc hai team cùng tạo hai bảng lịch sử trùng chức năng. Cả hai đều tuân đúng mọi AD.

**AD vá:** bổ vào AD-7: *"Hành động gia hạn = endpoint của module chủ bảng (devices/software); màn Expiry là UI gọi endpoint đó, expiry không bao giờ ghi end."* Quyết chủ cho lịch sử gia hạn — đề xuất: mỗi module chủ giữ bảng `*_renewal` của mình, hoặc tái dùng `audit_log` (FR-007 đã bắt ghi ai-sửa-gì) và expiry chỉ đọc qua audit service. Đồng thời bổ vào AD-3 luật đóng: *"bảng mới bất kỳ phải được thêm vào danh sách chủ ghi AD-3 trong cùng PR chứa migration tạo bảng — bảng không có chủ = review chặn."*

---

## LH-5 · HIGH — approvals giữ state, vault giữ cửa sổ xem: không ai chịu trách nhiệm đóng phiên hết giờ (FR-023)

**Cặp unit:** `vault` × `approvals`.

**Kịch bản vênh:** Break-glass được duyệt kèm thời hạn (mặc định 24h).
- Team **approvals** tuân AD-6: state chỉ đổi qua `transition()` khai báo — không AD nào yêu cầu họ tự expire, nên bản ghi đứng ở `approved` vĩnh viễn.
- Team **vault** check `status === 'approved'` là cho giải mã (tin rằng state machine phản ánh hiệu lực).

→ Member xem secret ở giờ thứ 25, audit vẫn ghi "hợp lệ" — thủng đúng chỗ PRD nhấn mạnh nhất, mà không ai vi phạm AD nào. Chiều ngược cũng vênh: nếu cả hai đều tự expire (approvals chạy sweep chuyển state + vault check timestamp và cũng gọi transition) → hai nơi đua nhau đổi status, đúng thứ AD-6 muốn cấm. Ngoài ra "phiên xem" (grace TOTP 10', UI tự ẩn N giây, "hết giờ tự đóng") là state không có bảng, không có chủ trong AD-3.

**AD vá:** bổ vào AD-6: *"Hiệu lực thời gian là thuộc tính đọc-tại-thời-điểm: approval mang `granted_until`; consumer (vault) BẮT BUỘC kiểm `now() <= granted_until` tại MỖI lần giải mã — status 'approved' một mình không bao giờ đủ. Approvals có duy nhất một sweep chuyển `approved→expired` phục vụ hiển thị/báo cáo; không module nào khác gọi transition này."* Bổ vào AD-4/AD-8: state phiên-xem-secret (grace TOTP, cửa sổ xem) thuộc vault (bảng do vault chủ hoặc gắn vào session của auth qua service auth) — nêu đích danh.

---

## LH-6 · HIGH — AD-5 buộc một transaction xuyên 3 module nhưng không định nghĩa cơ chế truyền transaction; `outbox`/`file`/`system_config` vô chủ trong AD-3

**Cặp unit:** mọi module ghi × `outbox` × `audit` (interceptor).

**Kịch bản vênh:** AD-5: nghiệp vụ + audit + outbox commit chung. Raw SQL qua `common/sql.ts`, không ORM — không có unit-of-work sẵn.
- Team **devices** truyền `PoolClient` làm tham số xuyên các hàm service.
- Team **vault** dùng AsyncLocalStorage giữ tx context.
- Team **audit** (interceptor chạy ngoài service) mở connection riêng vì không nhận được client của ai.

Ba cách đều "một request ghi = một transaction" theo cách hiểu của mỗi team; ghép lại thì audit commit ở connection khác → crash vẫn mất audit — chính rủi ro AD-5 sinh ra để chống. Thêm nữa: AD-3 không gán chủ ghi cho `outbox`, `file`, `system_config` — trong khi AD-5 ngầm bắt module nghiệp vụ INSERT message outbox trong tx của mình (vậy ai là "chủ ghi duy nhất" của bảng outbox?).

**AD vá:** AD mới tầng hạ tầng: *"`common/sql.ts` cung cấp cơ chế transaction duy nhất toàn hệ (`withTx(fn)` trên AsyncLocalStorage — mọi query trong scope dùng chung client; audit interceptor và `outbox.enqueue()` bám vào cùng scope). Cấm truyền client thủ công, cấm module tự mở transaction cách khác."* Bổ AD-3: `outbox` — chủ ghi = module outbox, module khác chỉ ghi qua `outbox.enqueue()` trong tx hiện hành; `file` = files; `system_config` = config; bảng luật digest = expiry.

---

## LH-7 · MEDIUM — port_map: hàng-một-chiều hay cạnh-hai-đầu — hai shape đều hợp lệ, không ai ghi bản ghi đối xứng

**Cặp unit:** story "port map trang thiết bị" (FR-006) × chính nó ở thiết bị đầu kia (và × "sơ đồ React Flow, vẽ dây = nhập port map" đã tuyên bố ở phase sau).

**Kịch bản vênh:** cùng một chủ ghi (`devices`, AD-3 thỏa) nhưng shape chưa quyết:
- Dev A: `port_map(device_id, port_no, plugged_label text, user)` — text tự do "AP tầng 3".
- Dev B: cạnh `(device_a, port_a, device_b, port_b)` vì phase 2 cần dựng sơ đồ từ port map.

Khi đầu kia cũng là thiết bị quản lý: switch ghi "port 7 → AP-3F", hồ sơ AP ghi uplink "→ switch port 5" — hai bản ghi tay về cùng một sợi dây, không cơ chế nào phát hiện lệch, dữ liệu thối dần; shape text thì phase 2 không dựng sơ đồ được — "chỉ thêm module mới, không đổi AD" của mục Deferred hóa ra sai.

**AD vá (đưa khỏi Deferred, quyết trong spine vì phase 2 phụ thuộc):** *"port_map là bảng CẠNH một-hàng-duy-nhất cho mỗi kết nối: `(device_id, port, remote_device_id NULL, remote_port NULL, label_text)` — remote nullable cho đầu không phải thiết bị quản lý; UNIQUE(device_id, port); trang chi tiết của CẢ HAI thiết bị render từ cùng hàng đó — không tồn tại bản ghi đối xứng."*

---

## LH-8 · MEDIUM — Field tự điền của sheets (FR-029): snapshot hay live — hai cách đều đúng chữ, vênh về giá trị bằng chứng ISO

**Cặp unit:** `sheets` × `devices`.

**Kịch bản vênh:** phiếu 0203/0213 tự điền "tên job backup, tên server".
- Team **sheets** (bị cấm import ngang) copy giá trị vào JSON của `sheet_period` lúc sinh kỳ (snapshot) — phiếu ổn định, hợp tinh thần "phiếu đã chốt thì khóa" (FR-031).
- Team khác build màn xem phiếu render **live** từ devices (qua compose frontend) — server đổi tên là phiếu kỳ cũ đổi theo → bằng chứng audit sai lịch sử.

Không ai vi phạm AD. Ngoài ra "job backup" là entity chưa module nào sở hữu — sheets tự bịa danh mục riêng, sau này devices/config cũng cần là có hai nguồn sự thật.

**AD vá:** convention mới trong Consistency Conventions: *"Field tự điền của sheets = SNAPSHOT tại thời điểm sinh kỳ, lưu trong `sheet_period`; lấy một lần qua read-service/API của module nguồn lúc sinh kỳ, sau đó không tham chiếu live; phiếu đã khóa là bất biến."* Quyết chủ cho danh mục "backup job" (đề xuất: danh mục thuộc `config` hoặc thuộc `devices` như thuộc tính server) và ghi vào AD-3.

---

## LH-9 · MEDIUM — Vòng đời license_assignment khi thiết bị bị khóa/xóa; FK chéo module trong bộ migration tuyến tính không ai cấp số

**Cặp unit:** `software` × `devices` (FR-009 × FR-001 khóa hồ sơ, open item "xóa hẳn").

**Kịch bản vênh:** devices khóa/xóa thiết bị; software sở hữu `license_assignment` nhưng không biết sự kiện đó (outbox theo AD-5 chỉ là đường email, không phải event bus nội bộ).
- Team **devices** tin FK `ON DELETE RESTRICT` sẽ chặn xóa khi còn assignment.
- Team **software** không dám khai FK sang bảng device ("bảng module khác" — AD không nói khai FK chéo có hợp lệ không) → xóa thành công, assignment mồ côi, đếm seat FR-009 sai.

Cả hai đúng chữ. Kèm theo: AD-10 dùng một dãy migration `0000..` nhưng `license_assignment` cần bảng `device` có trước — hai team đánh số trên nhánh riêng → đụng số/đụng thứ tự khi merge.

**AD vá:** bổ AD-13 (LH-1): *"FK chéo module BẮT BUỘC khai trong migration của module chủ bảng chứa cột FK, mặc định ON DELETE RESTRICT; 'khóa' không đụng bản ghi liên kết; 'xóa hẳn' chỉ hợp lệ khi mọi FK RESTRICT cho phép — buộc gỡ assignment/IP trước qua endpoint module chủ tương ứng."* Bổ AD-10: cơ chế cấp số migration tập trung (cấp số lúc merge vào main, một dãy duy nhất; trùng số = CI chặn).

---

## Ghi chú nhỏ (không thành lỗ hổng riêng)

- **FR-010 "IP WAN static" trên hồ sơ ISP** (module software): text hay FK sang `ip_address` của ipam? Nếu FK, WAN IP lọt vào thống kê % subnet (FR-020) gây méo số. Đề xuất: text/inet thuần trên hồ sơ ISP, ipam chỉ quản dải LAN — thêm một dòng convention.
- **FR-034 "link 2 chiều" Documents ↔ thiết bị/phần mềm:** bảng link do `documents` chủ (một hướng lưu, hai hướng hiển thị) — nên nói rõ một câu trong AD-3 để devices không tạo bảng link ngược.
- **FR-018 "thao tác xóa cũng để lại log":** hard-delete để lại dòng audit trỏ tới UUID đã biến mất — chấp nhận được, nhưng nên ghi chú audit_log không FK sang bảng nghiệp vụ (append-only, tham chiếu mềm).

## Tổng kết

| # | Lỗ hổng | Mức | AD liên quan |
|---|---------|-----|--------------|
| LH-1 | AD-2 tự mâu thuẫn về DI/import ngang; FK & quyền tạo liên kết device↔IP vô định | CRITICAL | AD-2, AD-3, AD-4 |
| LH-2 | AD-3 "chỉ đọc" hợp pháp hóa SELECT chéo mà AD-2 cấm; dashboard không có đường dữ liệu hợp lệ | CRITICAL | AD-2, AD-3 |
| LH-3 | Contract quét của expiry vênh AD-2; nguy cơ quét bảng secret phạm AD-4 | HIGH | AD-7, AD-2, AD-4 |
| LH-4 | "Đã gia hạn" không có đường ghi; renewal_history vô chủ | HIGH | AD-7, AD-3 |
| LH-5 | Không ai đóng phiên break-glass hết giờ; state phiên-xem vô chủ | HIGH | AD-6, AD-4 |
| LH-6 | AD-5 thiếu cơ chế truyền transaction; outbox/file/system_config vô chủ | HIGH | AD-5, AD-3 |
| LH-7 | port_map hai shape hợp lệ, bản ghi đối xứng không ai ghi | MEDIUM | AD-3, Deferred |
| LH-8 | Field tự điền sheets: snapshot vs live; entity "backup job" vô chủ | MEDIUM | AD-2, AD-3, Conventions |
| LH-9 | Vòng đời license_assignment khi khóa/xóa thiết bị; FK chéo & cấp số migration | MEDIUM | AD-3, AD-10 |

**Khuyến nghị thứ tự vá:** LH-1 và LH-2 trước tiên (một quyết định duy nhất về "đọc chéo module" sẽ đồng thời khép LH-1, LH-2 và một nửa LH-3/LH-8), sau đó LH-6 (nền transaction ảnh hưởng mọi endpoint ghi), rồi LH-3/LH-4/LH-5 trước khi tách epic F3/F5.
