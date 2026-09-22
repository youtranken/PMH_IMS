# Rà soát toàn diện IMS — 19/09/2026

Sáu chuyên gia đọc song song (backend · CSDL · frontend · văn bản giao diện · định danh tiếng
Việt · nợ kỹ thuật), cộng **bốn lượt Playwright lái tay trên stack docker thật** — không mock,
không đọc mò. Mọi con số dưới đây là **đo được**, và mọi finding có `file:dòng`.

Quy mô soi: 247 file TS api · 182 file web · 47 migration · 73 bài E2E · 52 bài Jest đơn vị ·
14 bài chạm DB thật · 44 bài Vitest · 1457 dòng `vi.ts` (1121 khóa lá).
HEAD lúc rà: `0349a8a`.

---

## 0. Bảng điểm

| Lớp | Điểm | Câu tóm tắt |
| --- | :---: | --- |
| **Backend / API** | **7,5** | `@Roles` đủ 100% trên 93 route, `tx` tường minh đủ, AD-1/AD-13 sạch. Nhưng 1 BLOCKER + 5 HIGH cùng một hình dạng: **một cửa được canh, cửa song song thì không** |
| **CSDL** | **7,6** | Lược đồ do người hiểu Postgres viết (exclusion GiST, partial unique, trigger `FOR SHARE`, 47 migration khớp journal chính xác). Rủi ro không ở `CREATE TABLE` mà ở ranh giới DB↔vận hành |
| **Frontend / React** | *(mục 7)* | |
| **Trợ năng (a11y) đo trên trình duyệt** | **8,5** | 0 input thiếu nhãn · 0 nút thiếu tên · 0 id trùng · 1 `aria-*` trỏ hụt trong toàn hệ thống · bẫy tiêu điểm và trả tiêu điểm đều đúng |
| **Đáp ứng 390px** | **9,5** | 0/21 màn tràn ngang; bảng gập thành thẻ dọc có nhãn; ngăn kéo mở/đóng/Esc đều đúng |
| **Văn bản giao diện** | **6,9** | Câu chữ tiếng Việt thuộc hàng tốt hiếm thấy — nhưng 94 chuỗi cứng ngoài i18n và 5 khái niệm mang hai tên |
| **Định danh trong mã** | **4,0** | 237 định danh + 15 tệp mang tên tiếng Việt; không cổng nào chặn cái mới sinh ra |
| **Nợ kỹ thuật đã ghi sổ** | **3,0** | 30/32 mục LOW **còn nguyên** — 0 mục được xử trong 4 commit sau khi lập sổ |

> Bảng điểm này là ẢNH CHỤP ngày 19/09 và **cố ý không sửa lại** — sửa nó là xoá mất chỗ
> xuất phát. Việc đã làm từ đó ghi ở **mục 16 (đợt A — cổng)** và **mục 17 (đợt B — ba lỗ,
> ba cửa)**; checklist ở mục 8 là nơi tra nhanh cái gì đã tick.

---

## 1. Lượt lái trình duyệt — điều đã tự tay kiểm

21 màn × 3 cảnh (desktop sáng · desktop tối · 390px) = **63 ảnh** + 21 cây trợ năng, lưu ở
thư mục nháp của lượt này. Bốn lượt: đi khắp sidebar · bấm thật từng chức năng · soi sâu bốn
chỗ nghi · chốt lại ba nghi vấn.

### 1.1 Nền sạch — đây là số đo, không phải lời khen xã giao

| Phép đo | Kết quả |
| --- | --- |
| Lỗi console trong CẢ lượt đi 21 màn | **1** (401 `/auth/me` trước khi đăng nhập — đúng thiết kế) |
| Request hỏng sau khi đăng nhập | **0** |
| Input thiếu nhãn · nút/link thiếu tên | **0 · 0** |
| `id` trùng trong DOM | **0** |
| `aria-*` trỏ vào id không tồn tại | **1** (`/dev/components`, màn nội bộ) |
| Khoá i18n lọt ra màn hình | **0** |
| Hex màu trong `style` inline | **0** |
| Tràn ngang ở 390px | **0/21 màn** |

### 1.2 Chức năng bấm thật — chạy đúng

- **Hộp thoại (8/8 màn):** Esc trên hộp sạch → đóng. Esc trên hộp **đã gõ dở** → hiện
  *"Bỏ những gì vừa nhập? — Hộp này đang có dữ liệu chưa lưu. Đóng lại là mất hết, không khôi
  phục được."* với hai nút *"Ở lại nhập tiếp"* / *"Bỏ"*. Bẫy tiêu điểm đúng, `aria-labelledby`
  đủ, `required` đúng số.
- **Menu ⋯:** tên kèm định danh dòng (`"Thao tác với Cao Thuấn"`), ↓ đi đúng thứ tự, Esc trả
  tiêu điểm **về đúng nút đã mở**.
- **⌘K:** mở được, tiêu điểm vào ô nhập, Esc trả tiêu điểm về nút *"Tìm nhanh"*.
- **Sáng/tối:** đổi được, **nhớ qua reload**, nhãn nút đổi theo trạng thái.
- **Link "Bỏ qua menu":** là Tab đầu tiên, Enter đưa tiêu điểm vào `main#noi-dung`.
- **390px:** ngăn kéo mở/đóng được, Esc đóng, tiêu điểm đúng.
- **Bảng:** phân trang, đổi số dòng (10/20/50/100), sắp xếp cột + `aria-sort` đều chạy.
- **Vai Member:** thấy đúng 11 mục; API trả **403** đúng chỗ; **không rò một email nào** trên
  màn ma trận quyền két sắt.

### 1.3 Hai thứ tôi nghi là lỗi — kiểm lại thì KHÔNG phải

Ghi ra để lượt rà sau khỏi mất công:

- **Ma trận quyền két sắt, 60 ô mang chữ "–".** Nhìn qua tưởng 60 nút cùng tên. Đọc cây trợ
  năng: mỗi ô là `button "E2E Thành viên — Thiết bị loại Camera: Không có quyền"`. Chữ "–" chỉ
  là phần nhìn. **Màn này làm trợ năng rất tốt.**
- **"Esc không đóng được hộp đang gõ dở".** Phép đo đầu của tôi sai: hộp hỏi lại **thay chỗ**
  hộp cũ nên số lượng `dialog` vẫn là 1. Kiểm lại bằng cách đọc nội dung → cơ chế chạy đúng.

### 1.4 Lỗi TÌM ĐƯỢC trên trình duyệt

| # | Mức | Chỗ | Chuyện gì |
| --- | :---: | --- | --- |
| **B-01** | **CAO** | `web/src/ui/command-palette.tsx:216-219` + 11 chỗ `ilike(` bên api | **Tìm kiếm không khớp tiếng Việt KHÔNG DẤU.** Đo trực tiếp: gõ `thiet` → **0 kết quả**; gõ `Thiết` → 1. `ket` → 0; `két` → 2. Nguyên nhân hai tầng: web dùng `toLowerCase().includes()` trần; api dùng `ILIKE`, mà `ILIKE` **không** gấp dấu (`SELECT 'Thiết bị họp' ILIKE '%thiet%'` → `f`, đã chạy trên DB thật) và extension `unaccent` **chưa cài** (`pg_extension` → 0 dòng). Người Việt gõ không dấu là chuyện thường ngày; đây là khiếm khuyết dùng-được lớn nhất tìm được. Trớ trêu: repo **đã có** hàm gấp dấu ở `api/src/common/import-plan.ts:41-46` và `service-account-rules.ts:105` — hai bản, chưa bản nào dùng chung (AD-15) |
| **B-02** | VỪA | `web/src/features/admin/accounts-screen.tsx` | **Màn danh sách DUY NHẤT không giữ trạng thái trong URL.** Đo: `/devices` gõ "CC" → URL `?q=CC`, reload giữ nguyên. `/admin/accounts` gõ "Cao" → lọc còn 1 dòng nhưng URL **không đổi**; bấm sắp xếp → URL **không đổi**; reload → về 7 dòng, ô tìm trắng. Không chia sẻ được link đã lọc, và nút Back của trình duyệt rời trang thay vì gỡ bộ lọc. Các màn khác đều dùng `useListUrlState` |
| **B-03** | VỪA | `web/index.html` + mọi route | **`document.title` giống hệt nhau trên cả 21 màn** — kể cả trang 404 — luôn là `"IMS — Quản lý hệ thống IT"`. Mở 5 tab là 5 tab không phân biệt được; lịch sử trình duyệt và bookmark vô dụng |
| **B-04** | VỪA | `web/src/features/ipam/subnet-detail.tsx` | **Trạng thái "Đã ẩn" không có ô đếm, và bị gộp vào "Trống".** Dải `172.16.15.0/24`: chip đếm `Tất cả 254 · Đang cấp 0 · Trống 254 · Nghi chết 0 · Đã thu hồi 0`, nhưng hàng `172.16.15.3` hiện chữ **"Đã ẩn"**. Bấm lọc "Trống" → dòng "Đã ẩn" **hiện lên trong kết quả**. DB xác nhận: `ip_address.status='free'` kèm `voided_at` khác null. Ngay phía trên, thẻ dải nói *"Giữ lại vì còn 1 hồ sơ IP mang lịch sử — không xóa hẳn được"*. Hai câu trên một màn nói ngược nhau, và bên nói sai là bên bảo ô đó **trống, cấp được** |
| **B-05** | VỪA | `web/src/features/software/software-screen.tsx:168` ↔ `api/src/modules/software/software.service.ts:137` | **Hồ sơ đã thanh lý vẫn đeo nhãn "Quá hạn 23 ngày".** `/software` vẽ `ExpiryBadge` cho mọi dòng bất kể trạng thái; cỗ máy hạn thì lọc `status <> 'retired'`. Kết quả: cùng một hồ sơ, `/software` kêu "Quá hạn 23 ngày" còn `/expiry` báo "0 Đã quá hạn" — trong khi `/disposal` nói thẳng *"Hồ sơ trong kho KHÔNG còn được tính hạn"* |
| **B-06** | VỪA | `api/src/modules/mail/mail.consumer.ts:30-40` | **Một câu log cho hai nguyên nhân trái ngược.** `build()` trả `null` cho CẢ "thiếu mẫu thư" (lỗi lập trình) lẫn "hồ sơ tham chiếu đã xóa" (vô hại); cả hai in cùng một WARN rồi **đánh dấu processed** — thư không bao giờ gửi lại. Log thật 24h qua có 7 dòng loại này (`approval.requested`, `account.created`, `auth.device.new`). Nghĩa là: một thư **duyệt break-glass** rơi vì lỗi mẫu sẽ biến mất y hệt một lượt dọn E2E |
| **B-07** | VỪA | `api/src` — 8 chỗ | **API tự dựng 8 đường dẫn tiếng Việt bản cũ**, trong khi `web/src/lib/routes.ts` tự khai là "NGUỒN DUY NHẤT" và quyết định 26/08 là URL tiếng Anh: `device-expiry-source.ts:35` `/thiet-bi/` · `software-expiry-sources.ts:57,71` `/phan-mem/`, `/duong-truyen/` · `ip-device-panel.ts:34` `/dia-chi-ip/` · `isp-device-panel.ts:31` `/duong-truyen/` · `mail.consumer.ts:89` `/duyet-yeu-cau` · `:182`, `:221` `/quan-tri/nhat-ky`. Chúng chạy được nhờ `LEGACY_ROUTES` chuyển hướng — trừ hai cái cuối (xem B-08) |
| **B-08** | **CAO** | `api/src/modules/mail/mail.consumer.ts:181-182, 220-221` | **Nút trong hai email CẢNH BÁO BẢO MẬT dẫn tới trang 404.** `auth.account.locked` và `security.probe.alert` đặt `ctaUrl` là `/quan-tri/nhat-ky` → chuyển hướng sang `/admin/audit-log` → mục đó `planned: true`, `App.tsx` **không đăng ký `<Route>`** → rơi vào catch-all 404. Tôi đã mở thẳng `/admin/audit-log` trên trình duyệt: `h1 = "Không tìm thấy trang"`. Hỏng đúng lúc người dùng cần nhất, và nằm trong thư không thu lại được |
| **B-09** | VỪA | `web/src/features/admin/accounts-screen.tsx` · `access-matrix-screen.tsx` | **Member mở được vỏ của hai màn quản trị.** `/vault` và `/dev/components` chặn đúng bằng 404, nhưng `/admin/accounts` và `/admin/vault-access` render đủ `h1` + phụ đề + **nút "Thêm tài khoản" bấm được**, rồi mới hiện *"Bạn không có quyền thực hiện thao tác này. **Thử lại**"*. Dữ liệu không rò (API 403 sạch, 0 email lọt), nhưng: (a) hai màn này thiếu hàng rào ở tầng route trong khi hai màn kia có; (b) **"Thử lại" cho lỗi 403 là lời khuyên không bao giờ đúng** — bấm bao nhiêu lần cũng vậy |
| **B-10** | NHẸ | `web/src/shell/app-shell.tsx:113-122` | **Mục "sắp có" trong sidebar câm với trình đọc màn hình.** `<span aria-disabled="true" title={t('nav.plannedHint')}>` — `aria-disabled` **không có nghĩa** trên `<span>` không `role`, nên trong cây trợ năng "Tài liệu" và "Nhật ký" là hai node chữ trần không vai trò. Lời giải thích nằm duy nhất trong `title=`, thứ chỉ mở được bằng chuột (đúng lớp lỗi L-20) |
| **B-11** | NHẸ | `web/src/css/detail-tabs.css:449` ↔ `web/src/css/table.css:297` | **Nhãn cột ở 390px thừa hưởng font mono của ô.** `.table-stack td::before { content: attr(data-label) }` không đặt lại `font-family`; ô nào mang `.mono` (`devices-screen.tsx:156` đặt `meta:{className:'mono'}`) thì **nhãn** cũng thành mono giãn chữ. Thấy rõ trên ảnh 390px: "Vị trí và người giữ" khác hẳn kiểu chữ so với "Loại", "Bảo hành" ngay cạnh |
| **B-12** | NHẸ | `web/src/features/devices/device-detail.tsx` | Khu license có **hai tiêu đề chồng nhau**: `LICENSE ĐANG CÀI` rồi ngay dưới `PHẦN MỀM ĐANG CÀI (2)` — hai tên cho cùng một bảng, cách nhau một dòng |
| **B-13** | NHẸ | `web/src/features/dashboard/dashboard-screen.tsx` | Thẻ "SỰ CỐ TUẦN QUA" nói cùng một điều hai lần: *"Phần quản lý sự cố chưa mở trong bản này. Hệ thống CHƯA theo dõi mục này."* |
| **B-14** | NHẸ | `web/src/features/ipam/subnet-list.tsx` | Thẻ dải đã tắt hiện *"Vô hiệu hóa 28/08/2026 · 121"* — `121` là `void_reason` nhưng **không có nhãn** nên đọc như số rác, và **thiếu `voided_by`** (`sa@pmh.com.vn` có trong DB). Luật tự đặt ở `docs/EPIC-MAP.md` là *"nói rõ **ai** tắt, khi nào, vì sao"* — đang thiếu vế đầu |
| **B-15** | NHẸ | vận hành | `login.rate_limit_per_ip` trên DB dev **đang là 500** (giá trị gốc 20) vì một lượt E2E chết giữa chừng không kịp trả lại. Chính `global-teardown.ts` in cảnh báo mỗi lượt chạy. Hàng rào chống dò mật khẩu đang tắt trên stack này — và cơ chế trả-lại là best-effort, nên cùng kịch bản sẽ lặp lại |

---

## 2. Nợ kỹ thuật cũ — mục 11 và cả sổ 32 mục

> **Con số quan trọng nhất của cả báo cáo này: 30/32 mục CÒN NGUYÊN, 0 mục ĐÃ XỬ.**
> Bốn commit sau khi lập sổ (`16a9c2d`, `a0e6693`, `8ec0cac`, `0349a8a`) xử một tập finding
> khác. Sổ nợ được lập rồi để yên.

Hai ngoại lệ:
- **L-28 — MÔ TẢ SAI NGAY TỪ ĐẦU, không có gì để sửa.** Vế "đột biến `onClick={()=>{}}` sống
  sót" sai: `e2e/tests/expiry.spec.ts:255-261` bấm thật rồi khẳng định `toHaveURL(/state=expired/)`
  + F5 + Back. Vế "các màn khác chưa có" cũng rỗng — `ui/kpi-strip.tsx:68/75` render `<Link>`
  khi có `to` và `<button aria-pressed>` khi có `onClick`; chỉ `expiry-screen.tsx` truyền
  `onClick`. **Không tồn tại ô số bấm-được nào khác.**
- **L-32 — mô tả sai một phần.** `rewrap()` **CÓ tồn tại** (`api/src/common/crypto/envelope.service.ts:73`,
  2 bài spec). Thứ chưa có là **job duyệt bảng**, và việc không dựng job đã được quyết 18/09.

### 2.1 Mục 11 — điều tra sâu (chủ dự án hỏi riêng)

**Kết luận: CÒN NGUYÊN, và xoá là an toàn tuyệt đối.**

| | |
| --- | --- |
| Vị trí | `web/src/css/primitives.css:34-201` |
| Kích thước | **13 tên lớp · 31 khối luật · ~168 dòng** |
| Grep chuỗi trần | **0 hit** trên `.tsx`/`.ts`/`e2e`/`index.html`/`design-ims` |
| Grep tên dựng động | Liệt kê **toàn bộ 47 chỗ** dựng class động trong `web/src` — **không chỗ nào** có tiền tố `dm` |
| Lai lịch | `git log -S` chỉ ra **đúng một** commit sinh: `72d1bda` (Story 1.1, 22/08) — lượt chép xương QLTS theo AD-12 |

**Điều tài liệu cũ nói sai:** đây **không phải** "một màn không tồn tại" theo nghĩa *đã bị gỡ*.
Chủ sở hữu thật là `F:/PMH/Project_QLTS/qlts/web/src/features/catalog/catalog-page.tsx` — nó
dùng đủ 13 lớp. Đó là **màn Danh mục master–detail của QLTS chưa bao giờ được port sang IMS**.
IMS tự dựng `catalog-screen.tsx` theo hình dạng bảng+tab với bộ lớp khác hẳn. **CSS này chết
từ phút đầu vào repo** — nên không có nhánh nào đang chờ lấy lại nó.

**Và cụm chết còn LỚN hơn mục 11** — cùng phương pháp, không nằm trong 32 mục:

| Cụm | Dòng | Tình trạng |
| --- | --- | --- |
| `.avail` + `.catalog-toolbar` | `primitives.css:2-32` | CHẾT (40 hit chữ "avail" trong `web/src` đều là từ `available`) |
| Họ `.pipe` (`.pipe` `.pnode` `.pc` `.plb` `.pbar`) | `primitives.css:204-256` | CHẾT — L-15 mới kê được `.plb`/`.pnode`; cả họ không nơi dùng |
| `.exp .panel` | `primitives.css:286-320` | CHẾT một phần — `.exp` và `.exp .exp-soft` còn SỐNG, chỉ `.panel` chết |

→ **~256/686 dòng của `primitives.css` (~37%) là CSS chết**, trong đó sổ nợ mới kê tên ~170.

**Đính chính khác trong nhóm CSS chết:** `.org` trong L-15 **không tồn tại** — ba "match" của
lượt rà gốc là `xmlns='http://www.w3.org/2000/svg'` bên trong SVG data-URI. L-16 **tự biến mất**
khi xoá L-14 (`.session-detail-row` là cha đã chết). L-13 là **7** khối luật chứ không phải 3.
L-06 là **4** nhãn chứ không phải 3.

### 2.2 Bảy chỗ mô tả đã trôi so với code hiện tại

| Mục | Sổ nợ ghi | Thực tế tại `0349a8a` |
| --- | --- | --- |
| L-17 | `detail-tabs.css:338` | **:379** — và `deferred-work.md` mở rộng lên **3 chỗ** (`base.css:38`, `detail-tabs.css:379`, `shared-kit.css:901`) |
| L-19 | 242 dòng | **264** dòng |
| L-20 | `catalog-screen.tsx:78-85` | **:81-88** |
| L-21 | `features/vault/…:401` | Đường thật là **`web/src/ui/vault-panel.tsx:401`** |
| L-23 | Provider chỉ bọc `children` | **Nặng hơn:** nhánh `title === undefined` (`dialog.tsx:398`) render `children` **không Provider nào cả** |
| L-24 | `dialog.tsx:120` | **:171-172** |
| L-11 | "màn không tồn tại" | Màn QLTS **chưa bao giờ port** — xem 2.1 |

### 2.3 Thứ tự xử đề xuất — gom theo lượt dọn làm chung một commit

| Lượt | Gồm | Công | Rủi ro |
| --- | --- | --- | --- |
| **1 · Dọn CSS chết** | L-11 · L-12 · L-13 · L-14 · **L-16 (tự biến mất)** · L-15 (21/22) · 3 cụm bonus | ~30 phút, **~300 dòng** rời repo | gần 0 |
| **2 · Chú thích nói đúng về code** | L-24 · L-26 · L-27 · L-28 (con trỏ) · L-32 (đính chính) | ~15 phút | 0 — không dòng chạy nào đổi |
| **3 · Chuỗi tiếng Việt về `lib/i18n`** | L-03 → L-10, **rồi mới** L-02 (dựng cổng) | ~3 giờ | Thứ tự bắt buộc — dựng cổng trước là đỏ tầng một, `--e2e` không chạy tới (bẫy số 5, `EPIC-MAP.md`) |
| **4 · Hộp thoại + đồng hồ két** | L-21 · L-22 · L-23 | ~1 giờ | L-22 là bài chứng minh L-21 không hỏng gì — gieo đột biến trước khi tin nó |
| **5 · Bản đồ quan hệ** | L-18 · L-19 | ~40 phút | thấp |
| **6 · Màu trong data-URI** | L-17 (cả **3** chỗ) | ~2 giờ | **Cao nhất.** Dọn màu TRƯỚC, nới `ops/gate-hex.sh` SAU |
| **Không xếp lượt** | L-01 (cần story Admin `system_config`, đã hoãn có chủ ý **4** lần) · L-20 (chọn Tooltip vs Dialog trước) · L-29/L-30/L-31/L-32 (vận hành + đánh đổi đã ghi) | | |

**Đừng báo lại ở lượt rà thứ tư:** L-01 (đã nêu ở `CODE-REVIEW-2026-08-28.md:127` + EPIC-MAP
Epic 1·3·6 + `deferred-work.md`), L-17 (`deferred-work.md`), L-29 (EPIC-MAP), L-32
(`secrets/README.md`).

---

## 3. Định danh tiếng Việt trong mã — câu trả lời cho đề nghị của anh

Đồng ý với anh, và đây là bản kiểm kê đầy đủ. Bốn lối tìm chồng nhau (từ điển ~900 âm tiết,
mẫu khai báo, quét token sau khi bóc chuỗi + chú thích, regex ký tự có dấu), đã lọc tay **96
dương-tính-giả** (`sameDay`, `parseDay`, `COUNT_CAP`, `cap`, `lang`, `toBe`…).

| Nhóm | Số lượng | Số tệp | Ưu tiên |
| --- | :---: | :---: | --- |
| **A** — Mã sản phẩm (`api/src`, `api/scripts`, `web/src`) | **47 định danh** | 11 | Cao nhất |
| **B** — Mã kiểm thử, tên định danh | **~175** | 32 | Trung bình |
| **C** — Tên tệp | **15** (0 thư mục) | 15 | Trung bình |
| **D** — Chuỗi mô tả `describe`/`it`/`test` | **1261/1307** | ~120 | **KHÔNG ĐỔI** — xem 3.3 |

**Ba vùng đã SẠCH:** 47 migration `.sql` (mọi hit là chú thích `--`), `ops/*.sh` (chỉ `echo`),
và khóa i18n trong `vi.ts` (đã là tiếng Anh camelCase — giá trị tiếng Việt là đúng thiết kế).

### 3.1 Mười lăm cái quan trọng nhất — vượt biên tệp, phải đổi trước

| Định danh | Tệp:dòng | Đề xuất | Nơi dùng | Rủi ro |
| --- | --- | --- | :---: | --- |
| `coHopThoaiDangMo` | `ui/dialog.tsx:67` | `isAnyDialogOpen` | 4 | **Mặt tiền AD-15** — `command-palette.tsx:9` import; phải khai lại `SHARED-REGISTRY.md` |
| `useCoHopThoaiDangMo` | `ui/dialog.tsx:75` | `useAnyDialogOpen` | 1 | Giữ tiền tố `use` |
| `moTimNhanh` | `ui/command-palette.tsx:88` | `openCommandPalette` | 3 | `app-shell.tsx` import |
| `SU_KIEN_MO_TIM_NHANH` | `ui/command-palette.tsx:85` | `OPEN_PALETTE_EVENT` | 4 | **Giá trị là chuỗi DOM `'ims:mo-tim-nhanh'`** — đổi TÊN HẰNG an toàn; đổi GIÁ TRỊ thì `dispatchEvent` + `addEventListener` phải cùng lượt, sót là palette câm mà **không bài nào đỏ** |
| `chuaBiet` | `relation-map.tsx:123,143` · `device-detail.tsx:591` | `isUnknown` | 13 | **PROP của component dùng chung** |
| `dangTai` | `relation-map.tsx:124,158` · `device-detail.tsx:596` | `loading` | 9 | như trên |
| `nenLocSanDangCap` | `slot-paging.ts:40` | `shouldIsolateAssigned` | 6 | `slot-paging.test.ts` import trực tiếp — sót là test đỏ (tốt) |
| `quetNguon` | `web/src/test/quet-nguon.ts:38` | `walkSourceTree` | 10 | Tài sản dùng chung sinh 19/09; tên viện dẫn trong **6 docblock** + `SHARED-REGISTRY.md` + `EPIC-MAP.md` |
| `timVaChoLoc` | `e2e/tests/helpers.ts:835` | `searchAndWaitForFilter` | 18 | Helper E2E dùng chéo nhiều nhất |
| `maLoiCua` | `vault.controller.ts:281` | `errorCodeOf` | 2 | `vault-surface.spec.ts` đọc file này dạng văn bản nhưng **không** ghim tên này — an toàn. **Đừng đổi `list`/`reveal`/`OwnerQueryDto`** |
| `khoa` | 5 tệp `*-history-entries.ts` | `key` | 33 | Không export; đổi cả loạt cho nhất quán |
| `chuKyCacO` · `thuDong` | `ui/dialog.tsx:195,228` | `fieldSignature` · `tryClose` | 5·6 | **Nằm trong deps array** — đừng tắt `exhaustive-deps` |
| `soCua` | `di-khap-giao-dien:6576` · `mau-trang-thai-sang-toi:222` | `countOf` | 8 | **Trùng tên khác thân ở hai tệp** — mùi AD-15, cân nhắc gộp về `helpers.ts` |
| `bỏQuen` | `reset-domains-rollcall.spec.ts` | `ignoreKnown` | — | **Định danh CÓ DẤU duy nhất trong repo** |
| `thuTu` | `api/scripts/reset-e2e.mjs:344` | `order` | 4 | Vô hại — script nhìn chữ `E2E` trong **dữ liệu**, không nhìn tên biến |

**KHÔNG đổi (là DỮ LIỆU, đổi là hỏng chức năng nhập Excel):** `kho`, `hong`, `'dang dung'`,
`'du phong'`, `'da thanh ly'` trong `devices/device-import.ts:76-91` và `catalog-import.ts` —
bảng ánh xạ nhãn người dùng gõ trong Excel → mã DB.

**Tên tệp (15).** Đã kiểm chứng: **không chỗ nào ghim tên tệp E2E** — `ops/ci-local.sh` không
nhắc tên `*.spec.ts` nào; job `e2e` trong `.github/workflows/ci.yml` **bị comment toàn bộ**
(dòng 107-151); `playwright.config.ts` lọc bằng MẪU. → Ràng buộc duy nhất là **giữ hậu tố
`.mobile.spec.ts`**; ngoài ra là `git mv` thuần. Ví dụ: `di-khap-giao-dien.spec.ts` →
`ui-walkthrough.spec.ts`, `khoa-dang-nhap-theo-noi.spec.ts` → `login-lockout-per-ip.e2e.spec.ts`
(thêm `.e2e` vì trùng tên một bài Jest), `web/src/test/quet-nguon.ts` → `walk-source-tree.ts`.

### 3.2 Kế hoạch đổi tên theo đợt

Mỗi đợt một commit độc lập, kết thúc bằng cổng của chính nó. **Không gộp đợt. Không đổi tên
cùng lượt với sửa logic** — diff phải đọc được là "chỉ đổi tên".

| Đợt | Nội dung | Kiểm chứng |
| :---: | --- | --- |
| **0** | **Dựng cổng canh TRƯỚC** (nửa ngày) — luật lint ở chế độ cảnh báo + allowlist đủ 222 tên hiện có. Làm ngược là trong lúc đổi lại sinh tên Việt mới ở chỗ khác | cổng xanh ngay |
| **1** | **Mặt tiền dùng chung AD-15** (9 tên) — rename có kiểu trong IDE, **không `sed`**. Sửa kèm `SHARED-REGISTRY.md` (DoD gạch 4) và mọi docblock viện dẫn | `npm --prefix web run build` (**KHÔNG** `tsc --noEmit` — `web/tsconfig.json` là file references, `--noEmit` ở đó kiểm **0 tệp**) + `npm --prefix e2e run typecheck` + `ops/ci-local.sh`; rồi `grep -rn` từng tên cũ **kể cả `docs/`** → 0 |
| **2** | **Mã sản phẩm còn lại** (38 tên, tất cả cục bộ) — một tệp một lượt | `ops/ci-local.sh` + `test:db`. **Bài đột biến:** đổi `>` thành `>=` trong `nenLocSanDangCap` rồi xem `slot-paging.test.ts` có đỏ không |
| **3** | **Tên tệp** (15) — `git mv` giữ lịch sử, giữ hậu tố | **Bắt buộc `ops/ci-local.sh --e2e`.** Chốt sàn: `npx playwright test --list \| wc -l` **trước và sau phải bằng nhau** |
| **4** | **Mã kiểm thử ngoài `di-khap-giao-dien`** (~92 tên / 30 tệp) | `ops/ci-local.sh` mỗi nhóm 5 tệp |
| **5** | **`di-khap-giao-dien.spec.ts`** (83 tên, một tệp) — để cuối. **Không `sed` toàn tệp**: nhiều tên là âm tiết ngắn (`hop`, `cot`, `dong`, `bai`, `loai`, `tao`, `bat`) **trùng chuỗi tiếng Việt trong `getByRole(...)`/`getByLabel(...)`** — sed sẽ ăn vào selector | `--e2e` + so `--list` trước/sau |
| **6** | Gỡ allowlist, siết lint lên `error`. Còn đúng hai mục có lý do viết ra: hai bảng ánh xạ nhãn Excel | |

### 3.3 Mô tả `describe`/`it`/`test` — đề nghị GIỮ nguyên tiếng Việt

1261/1307 khối đang là tiếng Việt. **Không nên đổi**, bốn lý do:

1. **Không phải định danh.** Luật của anh nói về *tên hàm/biến/tệp*. Chuỗi trong `it(...)` là
   văn bản đọc-cho-người, cùng hạng với chú thích và `echo` trong `ops/*.sh` — hai thứ cả repo
   đang viết tiếng Việt.
2. **Chi phí gấp ~6 lần A+B+C cộng lại**, và mỗi câu là một bản dịch phải xét nghĩa — không
   compiler nào kiểm được bản dịch sai.
3. **Rủi ro thật là `--grep`.** Playwright/Jest lọc bài theo chuỗi mô tả. Đổi chuỗi làm một
   lượt `--grep "két"` khớp **0 bài và báo XANH** — đúng lớp lỗi "cổng khớp 0 chuỗi" repo đã
   dính **hai lần** (28/08 api, 07/09 web).
4. **Đang làm đúng việc của nó.** Khi `ci-local.sh --e2e` đỏ, dòng đầu ra là tên bài, và người
   đọc là đội IT nội bộ PMH.

### 3.4 Luật lint đề xuất — chặn định danh tiếng Việt MỚI

**Hai lớp**, vì từ điển ~900 âm tiết không nhét vừa một regex đọc được:

**Lớp 1 — eslint bắt định danh CÓ DẤU.** Thêm vào **cả** `web/eslint.config.mjs` và
`api/eslint.config.mjs`:

```js
const NO_VIETNAMESE_IDENT = {
  selector: 'Identifier[name=/[\\u00C0-\\u1EF9]/]',
  message:
    'AD-16: tên định danh phải là tiếng Anh. Tiếng Việt chỉ ở GIAO DIỆN (qua lib/i18n) ' +
    'và trong chú thích. Xem docs/SHARED-REGISTRY.md.',
};
// 'no-restricted-syntax': ['error', NO_NATIVE_DIALOG, NO_VIETNAMESE_IDENT],
```

**Lớp 2 — bài "điểm danh"** cho tiếng Việt KHÔNG dấu. Repo đã có sẵn đúng cơ chế này
(`dead-keys-rollcall.test.ts`, `confirm-title-rollcall.test.ts`, `history-action-rollcall.test.ts`):
quét source dạng văn bản qua `quetNguon`, đối chiếu một hằng miễn trừ, đỏ khi có mục mới. Từ
điển đặt MỘT chỗ (`web/src/test/vietnamese-syllables.ts`), khai vào `SHARED-REGISTRY.md`. Hằng
nợ `NO_CU` **chỉ được phép co lại** — thêm một bài chốt chính điều đó.

**Bài canh chính cái cổng — BẮT BUỘC.** Repo đã dính **ba lần** lớp lỗi "luật viết ra mà khớp
0 chuỗi". `web/src/lint-rules.test.ts` ra đời chính vì thế — nó **chạy thẳng eslint trên file
probe**. Luật mới phải có bản tương ứng trong chính file đó, gồm **cả vế phủ định**:

```ts
it('AD-16 KHÔNG bắt nhầm chuỗi tiếng Việt trong i18n và chú thích', () => {
  // Nếu bài này đỏ thì luật đang chặn cả đường đi ĐÚNG, và người ta sẽ tắt luật đi.
  const { failed } = lintSnippet(
    `// Hộp thoại xác nhận — chú thích tiếng Việt là ĐÚNG luật.\n` +
      `export const label = 'Xoá thiết bị?';\n` +
      `export const key = 'devices.deleteTitle';\n`,
  );
  expect(failed).toBe(false);
});
```

**Ghi vào luật kiến trúc:** thêm **AD-16** vào `ARCHITECTURE-SPINE.md` và mở rộng DoD gạch 2 từ
"AD-1..AD-15" thành "AD-1..AD-16".

---

## 4. Văn bản giao diện

| Tiêu chí | /10 | Lý do |
| --- | :---: | --- |
| Nhất quán thuật ngữ | **5,5** | 94 nhóm khóa trùng chữ; **5 khái niệm có hai tên trên cùng một màn** |
| Chất lượng câu lỗi | **8,0** | Nền rất tốt — **0/194** điểm ném lỗi API còn tiếng Anh |
| Phủ i18n | **6,5** | **94 chuỗi tiếng Việt cứng** (57 ở màn người dùng); 0 khóa thiếu, 0 khóa chết lộ ra |
| Rõ nghĩa nhãn/nút | **7,0** | 24/25 hộp hỏi lại có tiêu đề đủ; hỏng ở 2 hộp két sắt + 1 nút lệch động từ |
| Trạng thái rỗng·tải·lỗi | **7,5** | 21 `EmptyState` · 36 `LoadError` · 34 `Loading`; 6 chỗ nói sai hoặc chung chung |

**Điều đáng nói trước:** câu chữ tiếng Việt của IMS thuộc hàng **tốt hiếm thấy**. Trạng thái
rỗng không phải "Không có dữ liệu" mà là *"Mỗi lần mở port trên Draytek thì ghi vào đây — bên
kiểm toán sẽ hỏi, và cuốn sổ này là câu trả lời."* Đó là chỗ mạnh thật, đừng làm mất khi dọn.

### 4.1 Ba thứ nên sửa trước

| # | Mức | Chỗ | Chuyện gì |
| --- | :---: | --- | --- |
| **T-01** | **CAO** | `web/src/ui/time-picker.tsx:246,265,271,275,288,291,298,301` | **6 chuỗi tiếng Anh** — `Select Time` · `AM`/`PM` · `Time` · `Now` · `Cancel` · `Done`. Hôm nay chưa ai thấy vì `DateTimePicker` chưa màn nào dùng — **nhưng `docs/SHARED-REGISTRY.md:55` khai nó là bản dùng chung BẮT BUỘC cho "mọi ô chọn ngày/giờ"**. Sổ đăng ký đang chỉ người viết story sau vào đúng cái hộp tiếng Anh này; lượt dùng đầu tiên ship nguyên "Select Time / Now / Cancel / Done" ra sản phẩm và **không cổng nào đỏ**. Hai khóa (`timePicker.choose`, `common.cancel`) **đã có sẵn** |
| **T-02** | **CAO** | `mail.consumer.ts:181,220` | = **B-08** ở trên. Sửa được ngay bằng cách bỏ nút CTA, không phải chờ màn Nhật ký |
| **T-03** | **CAO** | `locales/dead-keys-rollcall.test.ts` | **Cửa canh khóa chết bị vô hiệu cho HAI namespace trọn vẹn.** Luật cứu một khóa nếu nó khớp *tiền tố* của bất kỳ template nào; hai template quá rộng: `` t(`nat.${ipCheck.reason}`) `` phủ **cả 60 khóa `nat.*`**, `` t(`serviceAccounts.${done}`) `` phủ **cả 58 khóa**. Hậu quả đo được: **8 khóa chết đang sống sót**. Đây là thứ duy nhất trong mục này **tự lớn thêm** nếu để yên. Vá: từ chối tiền tố kết thúc bằng `.`; gieo `nat.zzz:'x'` vào `vi.ts` — bài **phải** đỏ (hôm nay nó xanh) |

### 4.2 Một khái niệm — hai tên (mục #25 của đợt 12/09 chưa ai tick)

| Mức | Khái niệm | Bản A | Bản B | Nặng ở đâu |
| :---: | --- | --- | --- | --- |
| **CAO** | Giao thức "cả hai" | `catalog.protocolBoth` = **'TCP + UDP'** | `nat.protocolBoth` = **'Cả TCP và UDP'** | **Hai nhãn hiện trong CÙNG MỘT FORM**, cách nhau 3cm (`nat-screen.tsx:626` và `service-port-picker.tsx:53`) |
| **CAO** | Gỡ hồ sơ IP | badge `ipam.voidedBadge` = 'Đã ẩn' | toast `ipam.addressVoided` = **'Đã xóa hồ sơ IP.'** | **Câu thông báo NÓI SAI việc vừa làm.** Hồ sơ không bị xóa — nó ẩn đi, bật lại được. Người dùng đọc "Đã xóa" rồi đi khai lại từ đầu |
| **CAO** | Đóng phiên người khác | nút `accounts.killSession` = 'Đóng phiên' | câu hỏi `accounts.confirmKillSession` = *"**Đá phiên**…"* | Đợt D khai đã bỏ tiếng lóng "đá phiên" — thật ra **chỉ đổi cái NÚT**, câu hỏi trong chính hộp mà nút đó mở ra vẫn nguyên |
| **CAO** | Vô hiệu hóa | `catalog.deactivate` = 'Vô hiệu' | `serviceAccounts.disable` = 'Vô hiệu hóa' | Ba màn, hai động từ |
| VỪA | Ghế license | `software.seats` = **'Seat'** | `software.seatsNote` = '…**ghế** đã gán' | Cột bảng nói "Seat", câu ngay dưới cột nói "ghế" |
| VỪA | Trạng thái đã ngừng dùng | `software.statusRetired` (`vi.ts:513`) = **'Đã bỏ'** | `devices.statusRetired` (`:359`) · `serviceAccounts.statusRetired` (`:1150`) = **'Đã thanh lý'** | Cả ba đổ về cùng màn **Kho thanh lý** — nơi hồ sơ phần mềm hiện *"Đã thanh lý license"* trong khi màn `/software` gọi nó là *"Đã bỏ"* |

### 4.3 Còn lại

- **`accounts.statusDisabled` = 'Vô hiệu hóa'** trùng **y hệt** `accounts.disable` = 'Vô hiệu
  hóa' → trên màn Tài khoản **badge trạng thái và nút bấm đọc giống hệt nhau**. Sửa:
  `'Đã vô hiệu hóa'`.
- **Tiếng Anh trong câu tiếng Việt:** `access.noMembers` nói *"tài khoản **Member**"* trong khi
  vai trò tên là **'Thành viên'**; `catalog.readOnly`/`digest.readOnly` nói *"nhờ **Admin**"*
  trong khi `app.forbidden` đã viết đúng *"nhờ **Quản trị** cấp quyền"*.
- **"Break-glass"** ở ô KPI đầu trang chủ — tiếng Anh không giải thích, và câu rỗng ngay dưới
  gọi nó là *"xin quyền xem tạm thời"*. Hai tên trong **cùng một thẻ**.
- **4 màn (`devices`/`software`/`isp`/`serviceAccounts`) dùng chung một câu rỗng cho hai cảnh
  khác nhau** — hệ thống mới tinh chưa ai lọc gì vẫn báo *"Chưa có thiết bị nào **khớp bộ lọc**"*.
- **`accounts-screen.tsx:420`** là chỗ **duy nhất** trong 14 chỗ còn dùng `common.empty` =
  'Chưa có dữ liệu' — gõ một từ không khớp là màn tuyên bố hệ thống chưa có tài khoản nào.
- **7/12 khóa câu rỗng không có dấu chấm cuối, 5 có** — chốt một lối.
- **"Tất cả" vs "Mọi"** trên cùng một thanh lọc: `Tất cả site` · `Tất cả tủ` · `Tất cả loại` ·
  **`Mọi trạng thái`**.
- `FIELD_LABEL` **thiếu 3 khóa** (`token`, `currentPassword`, `newPassword`) → câu lỗi ra
  *"token phải là chuỗi ký tự."* — tên trường tiếng Anh lẫn giữa câu Việt.
- **41 mã `audit_log` dạng `namespace.action` chưa có nhãn web**, và `history-action-rollcall.test.ts`
  **chỉ regex `recordWithin(`** nên không phủ `appendWithin(`/`@Audited(`. Ngày màn Nhật ký lên,
  41 mã in thẳng ra màn và **bài rollcall sẽ không đỏ**. Mở rộng bài quét **trước khi** xây màn.

---

## 5. CSDL — 7,6/10

| Hạng mục | Điểm | Căn cứ |
| --- | :---: | --- |
| Toàn vẹn dữ liệu | **7,5** | 14 bảng có CHECK vocabulary, exclusion GiST, partial unique, trigger chống race |
| Hiệu năng / index | **7** | `0042` là lượt dọn có đo; partial index nhất quán |
| Kỷ luật migration | **9** | 47 file khớp journal **chính xác**, checksum ép cứng, advisory lock, mỗi file một transaction |
| Phù hợp AD-3 | **9** | **35/35 bảng một chủ**; một import xuyên module và nó chỉ khai FK |
| Khả năng vận hành | **5,5** | Bốn suy thoái đều, không có gì đỏ để báo |

### 5.1 BLOCKER — chặn khi lên prod

**D-01. App chạy bằng SUPERUSER kiêm OWNER → append-only (NFR-03) tháo được bằng một câu lệnh.**
`SELECT rolsuper FROM pg_roles WHERE rolname='ims'` → `t`. `REVOKE` ở `0005_audit_append_only.sql:7`
đã chạy đúng, nhưng **superuser bỏ qua toàn bộ ACL** → câu REVOKE là trang trí, và AD-9
("REVOKE UPDATE/DELETE tầng DB role") **không đúng với thực tế đang chạy**. Trigger là lưới
thật, nhưng chính `0039:17-22` tự khai lỗ còn lại: owner làm được `DISABLE TRIGGER`. Kịch bản:
ai có `DATABASE_URL` → `ALTER TABLE audit_log DISABLE TRIGGER ALL; DELETE FROM audit_log WHERE
actor=…` → gọt sạch dấu vết, không lớp nào ghi lại.
*Đã biết, đã hoãn (`CODE-REVIEW-2026-08-28.md` F-DB-02) — giữ mức BLOCKER vì nó cần một bước
**triển khai** (tách role `ims_app`), nên sẽ không tự rơi vào epic nào.*

### 5.2 CAO

| # | Chỗ | Chuyện gì |
| --- | --- | --- |
| **D-02** | `auth/session.service.ts:182-189` | **`purgeOld()` viết xong, chú thích ghi "Gọi từ sweep (worker)", KHÔNG AI GỌI.** Grep toàn repo → đúng 1 kết quả là chính dòng định nghĩa. Dữ liệu sống: **54.904 phiên, 54.889 đã thu hồi, 0 phiên còn sống**, 33 MB; `sessions_last_seen_idx` (11 MB) dựng riêng cho nó → **0 lượt quét**. Sửa: một dòng `sweep.register(...)` trong constructor, y hệt `login-failure.service.ts:33` |
| **D-03** | `approval` | **Đúng cổng AD-6, và là bảng ghi DUY NHẤT không có CHECK cho từ vựng trạng thái.** 14 bảng khác đều nhân đôi vocabulary xuống DB. Kịch bản: một lượt ghi đặt `state='Pending'` → hàng **thoát khỏi** partial unique `approval_one_pending_key WHERE state='pending'` (AD-6 "một yêu cầu treo" im lặng ngừng hiệu lực, tạo được N break-glass song song) **và** thoát khỏi filter màn duyệt |
| **D-04** | `catalog/catalog.service.ts:296-322` | **`remove()` dựa vào FK RESTRICT — 3/7 danh mục không có FK nào trỏ tới** (`department`, `isp_provider`, `service_port`: `confrelid` = 0). Nhánh `catch(23503)` là code chết và `remove()` **luôn thành công**. Xóa phòng ban "Kế toán" → 40 thiết bị vẫn mang chuỗi đó, biến khỏi ô chọn, không lọc ra được bằng bất kỳ giá trị nào |
| **D-05** | `device.department`, `service_account.department`, `isp_line.provider` | **Ba cột tham chiếu danh mục bằng CHUỖI TỰ DO**, không validate. Hai đường hỏng: (1) `"Kế toán"/"Kế Toán"/"Ke toan"` là **ba** phòng ban với `eq()`; (2) đổi tên "Viettel"→"Viettel Telecom" là UPDATE hợp lệ nhưng 30 `isp_line` cũ giữ chuỗi cũ, và quyền vault `scope_type='isp_provider'` trỏ vào hư không. **Sửa D-04+D-05 một lần:** FK tới cột `name` (citext UNIQUE) `ON UPDATE CASCADE ON DELETE RESTRICT` |

### 5.3 VỪA

- **`audit_log_actor_trgm` — 11 MB GIN trên bảng ghi nóng nhất, 0 lượt dùng/28 ngày.** `EXPLAIN`
  đúng hình dạng câu thật cho thấy planner đi theo `created_at DESC LIMIT` rồi lọc, **không bao
  giờ** chọn GIN. 231.692 dòng/28 ngày ⇒ 11 MB chi phí ghi thuần.
- **`audit_log`: 92 MB index trên ~52 MB heap, KHÔNG CÓ đường lưu trữ nào về nguyên tắc.** DELETE
  + TRUNCATE + UPDATE đều bị trigger chặn ⇒ đường duy nhất là chính D-01. Quyết định trước prod:
  `PARTITION BY RANGE (created_at)` cho phép `DETACH` mà không phá append-only. Làm lúc bảng
  50 GB đắt hơn nhiều.
- **`outbox` chưa bao giờ được dọn** — 56.507 hàng, **0 hàng chưa xử lý**, 14 MB, không có
  `purge`. Khác `audit_log`: đây là hàng đợi, không phải sổ cái, không trigger nào cấm xóa.
- **`device_port` không gì chặn hai bản ghi cùng chiếm một cổng đầu kia (phạm AD-14).** Unique
  chỉ có `(device_id, port_label)`. Màn `SW-CORE` sẽ hiện hai sợi dây vào một lỗ vật lý — và
  đây đúng là dữ liệu người ta tra lúc đi kéo dây.
- **`isp_line.wan_ip` là `text`** — cột IP duy nhất lọt lưới, trong khi ipam làm rất đúng
  (`inet` + `family()=4`, `cidr` + `gateway_within_check`).
- **`device_port.vlan text` vs `subnet.vlan integer CHECK(1..4094)`** — thêm trong **cùng một
  migration** `0029`, khác kiểu; không JOIN được với nhau, mà đó chính là câu người ta muốn hỏi.
- **Bộ máy `CONCURRENTLY` của runner chưa từng chạy** — marker `ims:no-transaction` có, lưới
  phát hiện index INVALID có, chú thích rất kỹ; **0 file dùng**. Đề xuất dùng nó cho lần tạo
  index tiếp theo trên `audit_log` **dù lần đó nhanh**, để đường thoát hiểm được diễn tập.

### 5.4 Đã kiểm, KHÔNG phải lỗi — và một đính chính cho sổ nợ

- **L-30 đo xong → GIỮ CẢ HAI, đóng mục này.** `actor_idx` 554 lượt/17 MB, `actor_action_at_idx`
  865 lượt/18 MB; `EXPLAIN` cho **Index Only Scan** ở cả hai hình dạng. Bỏ `actor_idx` thì
  `WHERE actor=? AND created_at>?` **mất tư cách index cond** trên `created_at` (vì `action`
  chen giữa) → quét mọi hàng của actor đó, đúng câu `SecurityProbeService` chạy nhiều nhất.
  **Index audit_log thừa thật là `actor_trgm`, không phải cặp mà L-30 nghi.**
- **AD-3 sạch tuyệt đối:** 35/35 bảng đúng một `pgTable`, đúng một module. Cross-module schema
  import: **đúng một**, và nó chỉ khai `.references()`.
- **Migration gần như hoàn hảo:** 47 file `0000`–`0046`, không số trùng/khoảng trống; `diff`
  giữa `_migrations` và thư mục → **khớp chính xác 47/47**.
- **Ngày giờ đúng spine 100%:** không một `timestamp without time zone` nào trong cả 35 bảng.
- Append-only phủ **10/10** bảng, mỗi bảng đủ 3 trigger; `0039` kiểm `to_regclass()` và **fail
  to** nếu danh sách lệch schema.
- `nat_rule_no_overlap` EXCLUDE GiST + `int4range(…,'[]')` + partial `WHERE voided_at IS NULL`
  — đúng công cụ cho chồng lấn dải cổng, thứ UNIQUE không bắt được.
- `0044` bắt được lỗi rất tinh — `BEFORE UPDATE OF` là một **bộ lọc** nên đường bật lại IP
  không kích hoạt trigger — và sửa đúng.
- `outbox` relay: claim trong transaction **ngắn** (`FOR UPDATE SKIP LOCKED`), `queue.add`
  **ngoài** transaction, `jobId=event.id` khử job đúp — đúng pattern transactional outbox.

---

## 6. Frontend — 6,1/10

| Trục | Điểm | Lý do |
| --- | :---: | --- |
| Đúng đắn React | **6,5** | Không mutate cache, key đúng, `queryKey` đúng; ba bẫy nặng của đợt 19/09 đã vá **thật** (dựng lại từng cái). Trừ vì F-01, F-02 và hai cơ chế `ui/` mô tả một điều **không thể xảy ra** |
| Tuân thủ AD-15 / token | **6** | Token gần như hoàn hảo — riêng nó là 10/10. Nhưng ~90 lớp CSS chết + **2 file chết 100%**, 5 cụm bản sao trong `features/`, và 4 màn quay lại `useState` mà registry cấm thẳng |
| Trợ năng | **5,5** | Nghiêm ở chỗ khó (skip-link, focus trap, listbox đúng chuẩn, tương phản đo bằng máy), hổng ở chỗ dễ |
| An toàn kiểu | **6,5** | Gần như không `as any`. Trừ nặng vì `strict` tắt biến **20 dấu `!`** thành 20 lời khẳng định không ai kiểm — **6 trong số đó sai thật** |
| Hiệu năng | **6** | `staleTime` toàn cục đúng, phân trang server-side. Trừ vì không chia gói theo route, 2 ô tìm không debounce, 3 màn tính lại danh sách nặng ngoài `useMemo` |

> Một frontend xây rất có kỷ luật, với chú thích kỹ thuật thuộc loại tốt nhất từng đọc trong
> một repo nội bộ. Điểm bị kéo xuống **không** vì thiếu hiểu biết mà vì **thiếu cơ chế ép**.

### 6.1 BLOCKER — bản vá 19/09 của màn Sắp hết hạn là no-op hoàn chỉnh

**F-01 · `web/src/features/expiry/expiry-screen.tsx:153` · `:191` · `:216`**

```tsx
153:  const nguong = expiry.data?.thresholds ?? thresholds;
154:  const rows = allRows.filter((row) =>
155:    state === '' ? true : levelFromDays(row.daysLeft, nguong) === state);
158:  const columns = useMemo<ColumnDef<ExpiryRow, unknown>[]>(() => [ …
191:        cell: ({ row }) => <ExpiryBadge end={row.original.end} thresholds={nguong} />,
216:    [t, kinds.data],          // ← `nguong` KHÔNG có trong deps
```

`ui/expiry-badge.tsx:38-40` có **12 dòng chú thích** mô tả chính xác cảnh hỏng mà prop này sinh
ra để dẹp: *"bảng lọc theo 14 còn huy hiệu tô theo 7 — cùng một dòng, cùng một màn, hai câu
trả lời."* Cảnh đó đang sống lại.

**Kịch bản tái lập được, không cần lỗi mạng.** Admin đặt `expiry.critical_days = 14`. Vào Bảng
điều khiển (nạp sẵn cache `['expiry','kinds']`) rồi bấm sang `/expiry`:

1. Render đầu: `expiry.data === undefined` → `nguong = DEFAULT_EXPIRY_THRESHOLDS` = **7/30**.
2. `columns` dựng xong, **đóng băng** `nguong = 7/30` vào closure của `cell`.
3. `expiry.data` về mang `thresholds = 14/30`. `t` không đổi, `kinds.data` không đổi →
   **memo không tính lại**.
4. `rows` (dòng 154, **ngoài** memo) lọc theo **14**; `ExpiryBadge` tô theo **7**.

Ô "Gấp" ghi 6, bấm vào ra 6 dòng, chỉ 2 dòng đỏ.

**Vì sao không bài kiểm nào đỏ:** `DEFAULT_EXPIRY_THRESHOLDS` = 7/30 = **đúng seed của
migration 0041**, nên mọi lượt E2E/dev chạy ở đúng cấu hình che lỗi; và `features/expiry/`
**không có file `.test.tsx` nào**. Xanh vì lý do sai.

eslint **đã in ra** đúng dòng, đúng tên biến (`missing dependencies: 'kindLabel' and 'nguong'`).
Không ai phải đọc nó — xem F-03.

### 6.2 CAO

| # | Chỗ | Chuyện gì |
| --- | --- | --- |
| **F-02** | `device-detail.tsx:216` · `dashboard-screen.tsx:109` · `isp-detail.tsx:80` · `service-account-detail.tsx:84` · `software-detail.tsx:148` | **`data!` sau `isLoading`: mất mạng là TRẮNG TRANG, 6 trang.** `lib/api-client.ts:72-80` không khai `networkMode` → mặc định `'online'`. TanStack v5: mất mạng ⇒ `fetchStatus:'paused'` ⇒ `isFetching === false` ⇒ **`isLoading === false`**, `isError === false`, `data === undefined`. **Hai nhánh thoát đều trượt**, dòng sau đọc `item.status` → `TypeError`, và không ErrorBoundary nào được gắn (6.3). Chốt đúng: `if (!device.data) return <Loading/>` |
| **F-03** | `web/package.json:12` + `.github/workflows/ci.yml:63` | **Cổng lint web KHÔNG có `--max-warnings=0` → 30 cảnh báo đi thẳng qua cổng chặn merge.** `eslint.config.mjs:71` đặt `exhaustive-deps: 'warn'` **cố ý**. Hai quyết định ghép lại: cảnh báo dep thiếu không chặn được gì, và **F-01 là hậu quả trực tiếp**. `ops/ci-local.sh:163` có riêng tầng "RATCHET" cho `e2e/`; `web/` không có tầng tương ứng |
| **F-04** | `css/shared-kit.css:169-172` | **`FilePicker`: vòng tiêu điểm bàn phím KHÔNG BAO GIỜ vẽ.** `outline: 2px solid var(--ring)` — nhưng `tokens.css:49` khai `--ring` là **giá trị box-shadow**, không phải màu → khai báo không hợp lệ, trình duyệt vứt cả dòng. Input thật bị ẩn `clip: rect(0 0 0 0)`; label là thứ duy nhất nhìn thấy ⇒ **Tab tới ô chọn file không có tín hiệu nào** (WCAG 2.4.7). Ảnh hưởng mọi hộp Import + mọi khu đính kèm. **Chỗ duy nhất sai — 14 chỗ còn lại đều viết đúng `box-shadow: var(--ring)`** |
| **F-05** | `ui/select.tsx:103-107` | **Bản vá của `Combobox` chưa bao giờ áp cho `Select`.** `options` gần như không bao giờ bền identity (`pagination.tsx:316` — `PAGE_SIZES.map(...)`, mảng mới mỗi render). Mở menu, ↓ ba lần, cha render lại (refetch nền) → **dòng đang sáng nhảy về mục đang chọn**. Đúng cái `combobox.tsx:92-117` viết cả khối chú thích để chữa. `select.test.tsx` không có bài nào chạm `active` |
| **F-06** | `ui/date-picker.tsx:98-106` · `ui/time-field.tsx:138-145` | **Hai chú thích mô tả một cơ chế bất khả thi.** Chúng nói "capture + `stopPropagation` chặn Radix Dialog". Không thể: Radix cũng nghe ở `document` pha bắt và đăng ký lúc `RD.Content` mount, **tức trước**. Chính `dialog.tsx:255-259` đã ghi đúng sự thật này cho `select.tsx`. Thứ **thật sự** giữ form là `dialog.tsx:275`. **Ai gỡ dòng 275 vì tin hai chú thích kia sẽ làm Esc xoá trắng form đang gõ** |
| **F-07** | `ui/vault-panel.tsx:192,200` · `:295` | Hai lỗi cùng file. (a) **Admin bị chặn bởi một truy vấn họ không cần**: đường hiển thị là `isAdmin \|\| verdict.data?.canReveal`, nhưng `if (verdict.isLoading)` / `if (verdict.isError)` chạy **trước** ⇒ `/verdict` trả 500 thì SA/Admin **mất sạch panel Két sắt** dù quyền đủ — đúng thứ chú thích `:63` tuyên bố không xảy ra. (b) **"Đang chờ duyệt" là nhánh `else`, không phải sự thật**: Member bị `denied` và **chưa gửi phiếu nào** vẫn đọc "Đang chờ duyệt" → ngồi đợi một phiếu không tồn tại |
| **F-08** | `ui/attachment-panel.tsx:103` | **Đọc cache không đăng ký theo dõi.** `queryClient.getQueryData<Me>(ME_KEY)` không subscribe; `useApiMutation` invalidate `ME_KEY` sau **mọi** mutation ⇒ Admin mất nút Xoá, **và component không re-render khi cache về**. Chú thích `:98` khẳng định "`me` luôn có sẵn" — đó là giả định, không phải hàng rào |
| **F-09** | AD-15 — 5 cụm bản sao, **và chúng ĐÃ trôi lệch** | `display()`+`describe()` của panel Lịch sử **chép 5 lần** (`device`/`isp`/`nat`/`software`/`service-account` `-history-entries.ts`). Hai bản đầu giống nhau **từng byte**; nhưng `isp:62` có `if (field.endsWith('Id')) return t('history.changedOnly')` mà **bốn bản kia không** → sửa `siteId` ở màn NAT **in nguyên một UUID**. Ngược lại `nat`/`service-account` có luật tránh vẽ "A → A", ba bản kia không. `history-action-rollcall.test.ts` điểm danh **khoá i18n**, không điểm danh **luật hiển thị**. Cùng nhóm: `RenewDialog` chép nguyên khối (`isp-detail.tsx:553-642` ↔ `software-detail.tsx:351-446`); hook chọn thiết bị chép **3+1** lần; `buildFilterQuery` liệt kê TAY ở **5 màn** — chính cơ chế đã làm mất `search=` hồi 17/09, vá ở một chỗ, còn 5 cơ hội lặp lại |
| **F-10** | `ipam/subnet-detail.tsx:289` | **Hai hàng cùng địa chỉ, hàng SỐNG bị hàng ĐÃ ẨN nuốt.** `Map` khoá theo `address`; bật "Hiện hồ sơ đã ẩn" thì địa chỉ từng bị ẩn rồi cấp lại có **hai** hàng, `Map` giữ hàng cuối, **thứ tự do Postgres quyết**. Badge "Đã ẩn" cho địa chỉ đang dùng, "Đang cấp" hụt 1, menu bày "Bật lại" → API `IP_TAKEN`. Trông như "lúc đúng lúc sai" |

### 6.3 Năm cơ chế nữa viết đúng, chú thích hay, và không bao giờ chạy

Ngoài F-01 và F-06, cùng lớp lỗi:

| Cơ chế | Vì sao chết |
| --- | --- |
| `ui/chunk-error-boundary.tsx` ("Route dùng React.lazy…") | **Không route nào `React.lazy`** — `App.tsx:23-45` import cả 24 màn eagerly — và boundary **chưa từng được gắn** |
| `css/filters.css` — **trọn 50 dòng** | Không component nào render. Đúng cặp với `dirty`/`clearAll` đã gỡ khỏi `use-list-url-state`. Vẫn nằm trong `index.css:15` |
| `css/profile.css` — **trọn 185 dòng** | **Không có màn hồ sơ người dùng nào trong repo**; `PATHS` không có `profile` |
| `guardUnsaved` khi hộp không có `title` | `dialog.tsx:434` `bodyRef` **chỉ gắn trong nhánh `title !== undefined`** → cửa canh thành no-op **im lặng**. 14 nơi gọi hiện tại đều truyền `title`, nên là bẫy tiềm ẩn |
| `css/shell.css:71-194` (~120 dòng) | Menu chân sidebar bản cũ; `app-shell.tsx:140-160` chỉ còn dùng 4 lớp |

### 6.4 Trợ năng — hổng ở chỗ dễ

- **`ui/load-state.tsx:56` — `Loading` là vùng sống CÂM, ở 38 màn.** `<div role="status"
  aria-busy>` được **tạo ra cùng nội dung**. `relation-map.tsx:345` và `command-palette.tsx:487`
  đã vá sang mẫu node thường trực + `hidden` **đúng vì lý do này**; bản **dùng chung** thì
  không. Vá copy ở feature mà bỏ bản gốc trong `ui/` là ngược chiều AD-15.
- **`shell/app-shell.tsx:96-160` — drawer điện thoại không quản lý tiêu điểm.** Mở drawer,
  tiêu điểm ở nguyên `.nav-toggle` nằm **sau** `<nav>` trong DOM → Tab đi vào nội dung,
  **không bao giờ vào drawer**. Không bẫy tiêu điểm, không `role="dialog"`/`aria-modal`, phần
  còn lại không `inert`. Esc → tiêu điểm rơi về `<body>`.
- **`ui/page-header.tsx:92-127` — `Field` không tự nối nhãn với ô.** `<label htmlFor>` nhưng
  `{children}` là **anh em** của `<label>`. **56/145 `<Field>` không có `htmlFor`**, trong đó
  **8 chỗ con cũng không có tên trợ năng nào**. Gốc rễ: **`ui/combobox.tsx` không nhận prop
  `id`** nên `htmlFor` về nguyên tắc không dùng được với nó. Và **`aria-describedby` = 0 lần
  trong cả `web/src`** — `hint`/`error` không bao giờ được đọc kèm ô nhập.
- `access-matrix-screen.tsx:296`: **N nút cùng tên "Gán quyền"** không kèm định danh dòng
  (màn anh em `vault-home-screen.tsx:229` đã đúng); bảng ma trận hai tầng thiếu
  `scope="colgroup"`/`"col"`.
- `.segmented` dựng tay 3 chỗ dùng `aria-pressed` cho **nhóm loại trừ** — trình đọc màn hình
  nghe bốn công tắc độc lập thay vì "mục 2 trên 4". Mẫu đúng: `role="radiogroup"` + `aria-checked`.
- `port-map-panel.tsx:103,205` là **hai `<h3>` duy nhất** của cả `web/src` → nhảy h1 → h3.
- `nat-screen.tsx:209` ô Thao tác **thiếu `data-label`** → gãy ở 390px (**DoD gạch 6**); chính
  `subnet-detail.tsx:303-306` có chú thích viết ra để chặn.
- `title=` trên nút `disabled` (`import-dialog.tsx:507,518`, `vault-panel.tsx:277-282`): nút
  `disabled` không nhận pointer event, không vào tab order, **không hover trên cảm ứng** → lý
  do vẫn câm với đúng nhóm bị kẹt nhất.
- `time-picker.tsx:155` `role="spinbutton" aria-valuenow={value}` với `value` là **chỉ số bánh
  xe** → cột giờ xướng "0" cho 1 giờ.
- `date-picker.tsx:223`, `time-field.tsx:186`: `role="dialog"` **không tên, không dời tiêu điểm
  vào, không bẫy tiêu điểm**; lưới ngày là 42 `<button>` trần không `aria-label`, không
  `aria-current`, không điều hướng ↑↓←→.

### 6.5 Đã kiểm, KHÔNG phải lỗi (frontend)

- **Hex/rgb ngoài `tokens.css`: sạch.** 3 lần trong `.tsx` đều là **chú thích**.
- **Token sáng thiếu cặp tối:** 45 token, **44/45 là phi-màu** (`--space-*`, `--fs-*`, `--z-*`…).
  Còn lại là sidebar và màn đăng nhập — tối ở **cả hai** theme, đúng thiết kế.
- **Tương phản WCAG:** tính lại 24 cặp × 2 theme → **23/24 ≥ 4,5:1**. Cặp duy nhất dưới ngưỡng
  chỉ dùng cho viền/caret (≥3:1 đủ theo 1.4.11), trừ đúng một chỗ. **Các chú thích đo đạc
  trong `tokens.css` là chính xác.**
- **`.sort()`/`.splice()` trên cache TanStack: không có** — cả 3 chỗ đều sao chép trước.
- **`aria-*` trỏ id không tồn tại: 0 chỗ** trong `web/src`.
- **Cả bốn bẫy lớn của đợt 19/09 đã vá THẬT** — dựng lại từng cái: `use-list-url-state`
  ("máy in " + trang 3 không còn nhảy về trang 1), thứ tự effect `command-palette`, disclosure
  `relation-map` (5/5 xanh), và "đang tải ≠ hỏng".
- **`dialog.tsx:361-378` trả tiêu điểm khi tháo cả gốc: chạy đúng** (dựng bài Vitest tạm để đo,
  rồi xoá).
- `vault-home-screen.tsx:57` thiếu `searchKey` là **cố ý và đúng** — lọc ở client, registry ghi
  rõ ngoại lệ.
- `subnet-detail.tsx:133` (`all` đổi mỗi render): tác động ≈ 0 nhờ structural sharing. Sửa cho
  eslint xanh, **đừng** ghi là lỗi hiệu năng.
- Nút "Hủy" không `disabled` khi đang ghi (~10 hộp): **dữ liệu không mất** — `dialog.tsx:463-472`
  chặn ở pha bắt bằng `onClickCapture`.
- `row-actions.tsx` bàn phím **đủ chuẩn menu button**; số học modulo của `move()` đúng.
- **setState sau unmount: không tìm thấy chỗ nào.**

## 7. Backend / API — 7,5/10

| Trục | Điểm | Lý do |
| --- | :---: | --- |
| Kiến trúc | **8,5** | AD-1 sạch · AD-13 sạch · `@Roles` **đủ 100%** trên 93 route · `tx` tường minh **đủ** · AD-2/AD-3 sạch trừ đúng một chỗ |
| Bảo mật | **7,5** | Lõi vững; hổng ở đường gắn yếu tố thứ hai và hai guard không có bài kiểm |
| Đúng đắn | **6,5** | 1 BLOCKER + 4 HIGH đều là **cùng một hình dạng**: một cửa được canh, cửa song song thì không |
| Độ phủ kiểm thử | **6** | 893/893 xanh — nhưng 12 bài xanh vì lý do sai, và 3 module 0 test ở **cả hai** tầng |
| Khả năng bảo trì | **9** | Chú thích giải thích *vì sao* chứ không *cái gì*; mỗi hàng rào đều ghi lại sự cố đã sinh ra nó |

**Bốn cổng tự động đã chạy thật trong lượt rà này:** lint 0 error · depcruise 0 vi phạm ·
Jest **893/893 xanh** · build sạch. **Mọi finding dưới đây là thứ bốn cổng đó không thấy được.**

### 7.1 BLOCKER

**A-01 · `devices.controller.ts:75-77` + `devices.service.ts:198,424` — `PATCH /devices/:id
{"status":"retired"}` đi vòng qua TRỌN VẸN chốt thanh lý.**

DTO của **cả POST lẫn PATCH** nhận `status`, và `DEVICE_STATUSES` chứa `'retired'`;
`prepare()` `put('status', input.status)` ghi thẳng. `update()` chỉ có `assertNotRetired(before)`
— chặn **sửa hồ sơ ĐÃ thanh lý**, **không** chặn **thanh lý bằng đường sửa**.

**Kịch bản.** Máy `SW-01` đang giữ 3 IP `assigned`, 2 rule NAT sống, 4 ghế license.
`PATCH /api/v1/devices/<id>` body `{"status":"retired"}` — **vai `member` là đủ** — trả **200 OK**:

- không `FOR UPDATE` ⇒ bỏ qua toàn bộ hàng rào đua ở `setStatus` (`:248-276`);
- không hỏi `DeviceRetirementRegistry.holdingsWithin` ⇒ IP vẫn `assigned` và vẫn trỏ về máy đã
  bỏ, rule NAT vẫn mở, **4 ghế license bị chiếm vĩnh viễn** (máy mới đụng trần seat, người trực
  bị ép khai `overSeatReason` sai sự thật pháp lý);
- ghi `device.updated` ⇒ **lượt thanh lý vô hình** với ai tra theo `device.status-changed`.

**Bằng chứng đây là lỗi chứ không phải ý đồ:** đường import **đã bịt đúng cửa này** —
`device-import.ts:472-479` từ chối `status = retired` với câu *"Không thanh lý được bằng Excel:
thanh lý phải đi qua nút Thanh lý…"*, kèm chú thích `:456-459` *"hàng rào chặn ở màn hình, còn
Excel thì mở cửa sau"*. **Cửa sau HTTP còn rộng hơn Excel và chưa ai đóng.**

### 7.2 CAO

| # | Chỗ | Chuyện gì |
| --- | --- | --- |
| **A-02** | `auth.controller.ts:98-130` | **Gắn yếu tố thứ hai không cần xác thực lại.** Tài khoản chưa enroll + cookie bị trộm → kẻ tấn công enroll authenticator **của chính nó** → step-up → mở két. Đúng mô hình đe dọa mà `step-up.guard.ts` tự nêu, và `stepUp()` còn trả câu chỉ đường |
| **A-03** | `software.service.ts:345` · `isp-line.service.ts:390` | **`{"endDate":""}` xóa được ngày hết hạn mà luật không thấy.** `dateOnly("")` trả `null` = "xóa ngày", nhưng `(values.endDate ?? current?.endDate ?? null)` coi `null` y hệt `undefined` nên `validateSoftware` soi trên ngày **CŨ** ⇒ `requiresEndDate` không nổ, `updateWithin` ghi `end_date = NULL`. Chứng chỉ SSL không có hạn — đúng thứ `software-rules.ts:141-145` sinh ra để cấm — và vì `findExpiringBetween` lọc `end_date IS NOT NULL`, hồ sơ **biến mất khỏi mọi lời nhắc gia hạn, vĩnh viễn, không một dòng lỗi**. Không lưới DB. **Đường import làm ĐÚNG với cùng bài toán** (`device-import.ts:378-379` dùng `field in values`) — hai bản của một luật, một bản sai |
| **A-11** | `catalog.api.ts:41-49` · `devices.service.ts` | **Máy nằm trong một cái tủ thuộc về hư không.** `validateRefs` chỉ kiểm "tủ có thuộc site đã chọn không" **khi `refs.siteId` khác rỗng**. Gửi `{"siteId":""}` lên một thiết bị đang gắn tủ thì phép kiểm ấy bị bỏ qua trọn vẹn, và hàng ra có `cabinet_id` mà không có `site_id` — không lọc ra được bằng site nào, và trang chi tiết hiện một cái tủ không biết nằm ở đâu. **Đường Excel chặn đúng chuyện này** (`device-import.ts:388-397`, kèm câu từ chối tử tế); cửa HTTP thì không. Phát hiện 20/09 trong lúc vá A-03 — cùng họ, cùng hình dạng "cửa Excel được canh, cửa HTTP bỏ ngỏ", nhưng KHÔNG sửa cùng: bản vá A-03 chỉ đổi phép GHÉP, còn lỗ này cần thêm một LUẬT mới vào `validateRefs`, và luật mới có thể chặn dữ liệu cũ đang chạy |
| **A-04** | `nat-rule.service.ts:499-513` | **Trọng tài duy nhất cho chồng `both` vs `tcp/udp` chạy NGOÀI transaction** (`this.db`, gọi trước `db.transaction`). EXCLUDE của DB dùng `protocol WITH =` nên **không bao giờ** bắt `both` va `tcp`. Hai người cùng khai `TCP 8080` và `BOTH 8080` trên một router → cả hai qua cửa → sổ NAT có **hai câu trả lời cho TCP/8080** |
| **A-05** | `license-assignment.service.ts:226,263-271` | **Khóa hàng nhưng đọc trần cũ.** `.for("update")` chỉ `select({id})`; `used` đếm trong tx (đúng) nhưng `software.seatTotal` là ảnh chụp từ `:226` **ngoài tx**. Hạ `seat_total` 10→9 song song ⇒ gán thành 10/9 **không đòi `overSeatReason`**. Sửa: đọc lại cả hàng trong chính câu `.for("update")` |
| **A-06** | `ip-address.service.ts:307,340` | **Gán thiết bị cho IP `reclaimed` làm thiết bị KHÓA CỨNG, không thanh lý được.** `becomesAssigned` chỉ phủ `free`, nên hàng ra có `device_id = X` mà `status = reclaimed`. Rồi `listForDeviceWithin` **không lọc status** ⇒ thanh lý X **không** tick dọn → `DEVICE_HAS_HOLDINGS` chặn; **có** tick dọn → `transitionWithin(…,"reclaimed")` trên hàng đã `reclaimed` → `IP_TRANSITION_INVALID` và **cả transaction thanh lý rollback**. Cả hai lối đều tắc, và câu lỗi nói về một thứ người trực không hề đụng tới |
| **A-07** | `audit-query.service.ts:106-109` | **`audit` JOIN thẳng bảng `users` bằng raw SQL** (`LEFT JOIN users u ON u.email = a.actor`) — AD-2 cấm tường minh, và `users.api.ts:15-17` viết đúng câu bị vi phạm. Không cổng nào bắt: eslint khớp **chuỗi import** (ở đây không có), depcruise khớp **đường dẫn đã resolve** (SQL vô hình). **Không phải rủi ro lý thuyết** — chú thích ngay trên câu SQL ghi lại **hai lỗi production** sinh ra từ chính nó (`u.sub` không tồn tại → 500 suốt 9 epic; `created_at` mơ hồ → vỡ mỗi lần lọc ngày) |
| **A-08** | `dashboard.service.ts:16,172` | **Viết cứng cửa sổ 30 ngày, ghi đè `expiry.warning_days` đã có trong `system_config`** (AD-11) — trong khi chú thích còn hứa "khớp nhau" |
| **A-09** | `api/test/subnet-cidr-race.spec.ts:226` | **Lưới an toàn của cả file được thỏa mãn bởi một DÒNG CHÚ THÍCH.** Ba bài đua phía trên chạy trên SQL hằng số khai trong chính file test; docblock `:33-35` thừa nhận và chỉ sang bài này làm vế bù. Nhưng trong `subnet.service.ts`, chuỗi `FOR UPDATE` xuất hiện **lần đầu ở dòng 253, bên trong block comment**, câu SQL thật ở **257** — `indexOf` không phân biệt code với chú thích. **Xóa hẳn dòng 257 mà giữ chú thích thì cả 4 assertion vẫn xanh, và 3 bài đua cũng xanh.** *(Tôi đã tự mở hai file xác minh.)* Trớ trêu: `vault-surface.spec.ts:135-152` **đã vá đúng lớp lỗi này ngày 19/09** (lột chú thích trước khi so) — file này bị sót |
| **A-10** | `auth/csrf.guard.ts` · `auth/roles.guard.ts` | **Hai hàng rào không có bài kiểm nào** (84 + 51 dòng, 0 spec). CLAUDE.md liệt CSRF vào lõi bảo mật *"không có test thì không được merge"*. Hai nhánh bỏ qua im lặng không ai canh: `csrf.guard.ts:64` `if (!expected) return;` và `:66` `if (!origin) return;`. Guard anh em `StepUpGuard` có **hai** file spec; `RolesGuard` — hiện thân của AD-9 mặc-định-đóng — không có gì, và **không có cổng tĩnh nào đòi mọi controller khai `@Roles`** như `step-up-surface.spec.ts` làm cho step-up |

> **Hình dạng chung của A-01 → A-06:** một cửa được canh rất kỹ, cửa song song thì không — và
> trong ba trên sáu trường hợp, **cửa được canh là đường Excel/UI, cửa bỏ ngỏ là đường HTTP.**

### 7.3 Tuân thủ AD — phần SẠCH, đo trên toàn bộ 18 controller / 93 route

- **`@Roles`: đủ 100%.** `RolesGuard` mặc định đóng (ném `ROLES_NOT_DECLARED`) nên không route
  nào lọt được.
- **`tx` tường minh: đủ.** Quét `.transaction(` toàn `api/src`: **không một chỗ nào dùng
  `this.db` bên trong thân transaction** (3 hit duy nhất đều nằm trong chú thích). 11 chỗ gọi
  `enqueueWithin` đều truyền `tx`.
- **AD-1 sạch.** Không controller nào inject `DRIZZLE_DB` hay import `*.schema.ts`; không
  service nào đọc `@Req`.
- **AD-13 sạch.** `auditLogTable` không xuất hiện ngoài `modules/audit/`.
- **AD-2/AD-3 sạch trừ A-07.** `dashboard` — chỗ dễ phá nhất — chỉ đi qua sáu `*.api.ts`,
  không một câu SQL.
- **`@Audited` thiếu 4 chỗ (LOW):** 4 route ghi của `auth` không khai — nhưng **vết audit CÓ
  tồn tại** trong service, nên là khoảng trống KHAI BÁO, không phải mất dấu vết.
- **Tên hành động khai KHÁC tên thật service ghi (LOW):** `account.status.changed` ↔
  `account.locked`/`disabled`/`unlocked`; `catalog.created` ↔ `catalog.site.create`;
  `file.uploaded` objectType `file` ↔ objectType thật là `ownerType`. Ai tra nhật ký theo chuỗi
  trong `@Audited` sẽ nhận **0 dòng**.
- **Ba chỗ lệch câu chữ SPINE nhưng kiến trúc lành** (ghi để lần sau khỏi rà lại):
  `renewal_history` do `expiry` giữ; `users` do module `users` giữ (có ngoại lệ khai tường minh
  + test canh); `isp_line` sống trong `software` (đã khai ở `software.api.ts:41-47`).

### 7.4 VỪA — gom nhóm

- **Nhóm CAS thiếu:** `voidAddress`, `IpAddressService.update`, và **3 câu của `SubnetService`
  làm hỏng `restore()` vĩnh viễn**; `DevicePortsService` ghi lịch sử cho việc không xảy ra.
- **Outbox / mail:** cổng chống trùng là một lượt **ĐỌC**; giờ trong thư là giờ **gửi** chứ
  không phải giờ sự kiện; **không timeout SMTP** + concurrency 1; relay tuần tự bỏ kẹt 97 event.
- `expireDueGrants` thiếu `try/catch` từng dòng — một dòng hỏng chặn cả lượt.
- **Hai bản sao** `SOFTWARE_KINDS` / `SERVICE_ACCOUNT_KINDS` trong ma trận quyền két.
- `limit:500` **cắt im lặng** ở Kho thanh lý.
- **AD-11:** 5 ngưỡng `@Throttle` bảo mật + múi giờ màn Nhật ký + trần import + ngưỡng outbox
  đều viết cứng.
- **12 bài kiểm xanh vì lý do sai**; **3 module (`approvals`, `users`, `disposal`) 0 test ở cả
  hai tầng.**

---

## 8. Checklist — tick khi đã xong

> ### Đọc mã lỗi thế nào — và một cái bẫy tên gọi
>
> Chữ cái đầu của mỗi mã cho biết nó được tìm thấy Ở MỤC NÀO, **không** phải nó thuộc đợt làm
> việc nào:
>
> | Mã | Sinh ra ở | Số mục |
> | --- | --- | ---: |
> | **A-xx** | §7 Backend / API | 11 |
> | **B-xx** | §1 Lượt lái trình duyệt · §11 Lượt năm | 19 |
> | **D-xx** | §5 CSDL | 5 |
> | **F-xx** | §6 Frontend | 10 |
> | **T-xx** | §4 Văn bản giao diện | 3 |
> | **N-xx** | §13 Đo trên 30.000 hồ sơ | 3 |
> | **M-xx** | §8 Checklist | 1 |
>
> **Bẫy:** các mục §16–§20 từng mang tên "đợt A/B/C/D" — một hệ chữ cái THỨ HAI, đặt ra trong
> lúc làm việc và chồng lên hệ trên. "Đợt C" vá toàn mã **A-**, "đợt D" vá toàn mã **F-**, còn
> **D-02** thì chẳng liên quan gì tới "đợt D" và vẫn chưa làm. Câu "đợt D xong rồi" và "D-02
> vẫn còn" đúng cùng lúc — không trí nhớ nào chịu nổi. Từ 21/09 các lượt đánh **số**, và mỗi
> tiêu đề giữ một dòng đối chiếu sang commit vì commit đã đẩy đi, không viết lại được.

### 8.1 Chặn phát hành (3)

- [x] **A-01** Chặn `status: 'retired'` trên đường **`PATCH /devices/:id`** — bắt đi qua `setStatus`, y như `device-import.ts:472` đã làm. **Sửa lại lời khai 21/09:** ô này từng ghi `PATCH/POST`, nhưng `POST` cố ý KHÔNG chặn — tạo mới một máy đã ở trạng thái thanh lý là việc thật (nạp kho lịch sử lần đầu), và `device-import.ts:423-427` đã quyết định đúng như vậy kèm lý do: một bản ghi vừa sinh ra thì chưa giữ IP/NAT/ghế license nào để mà dọn. Chốt `setStatus` sinh ra để hỏi đúng câu đó, nên nó không có việc gì ở đường tạo mới. Hai tầng rà soát chéo đều báo đây là lỗ vì đọc `create()` thấy thiếu chốt mà không mở nhánh create của đường Excel — lời khai sai của ô tick này là thứ dẫn họ tới đó.
- [x] **F-01** Thêm `nguong` vào deps của `useMemo` ở `expiry-screen.tsx:216` (hoặc bỏ memo) + một bài Vitest cho `features/expiry/`
- [x] **D-01** Tách role `ims_app` không-superuser trước khi lên prod — nếu không, AD-9/NFR-03 không đúng với thực tế đang chạy

### 8.2 Cổng — làm trước thì mọi mục dưới rẻ đi (5)

- [x] **F-03** `--max-warnings=0` cho `npm --prefix web run lint` (và `api`), dọn 30 cảnh báo → **bắt được F-01 miễn phí**
- [x] **A-09** `subnet-cidr-race.spec.ts` lột chú thích trước khi so, theo đúng mẫu `vault-surface.spec.ts:135-152`
- [x] **A-10** Bài kiểm cho `CsrfGuard` + `RolesGuard`, và một cổng tĩnh đòi mọi controller khai `@Roles`
- [x] **T-03** Vá luật cứu-theo-tiền-tố của `dead-keys-rollcall` (từ chối tiền tố kết thúc bằng `.`); gieo `nat.zzz` để chắc nó đỏ
- [x] **Đợt 0 của mục 3** Luật lint chặn định danh tiếng Việt MỚI *(lớp 1 — có dấu; lớp 2 hoãn, xem 16.7)* (hai lớp + bài canh chính cái cổng, có cả vế phủ định)

### 8.3 Đúng đắn — CAO (13)

- [x] **A-02** Đòi xác thực lại trước khi gắn yếu tố thứ hai
- [x] **A-03** `field in values` thay cho `??` ở `software.service.ts:345` + `isp-line.service.ts:390` *(và `devices.service.ts:442-455` — chỗ thứ ba, rà soát bỏ sót; xem 17.2)*
- [x] **A-11** `validateRefs` kiểm cặp tủ↔site cả khi site bị XOÁ, không chỉ khi site có giá trị (đếm trước xem dữ liệu đang chạy có bao nhiêu hàng `cabinet_id IS NOT NULL AND site_id IS NULL`)
- [x] **A-04** ~~Đưa `siblings` vào trong transaction + khóa hàng `device`~~ → **vá ở DB thay vì thêm khóa**: `0050` ánh xạ giao thức thành khoảng rồi so `&&` (xem 19.1)
- [x] **A-05** Đọc lại cả hàng `software` trong chính câu `.for("update")`
- [x] **A-06** `becomesAssigned` phủ cả `reclaimed`; `listForDeviceWithin` lọc status *(hỏi `isOccupying` chứ không liệt kê tay)*
- [x] **A-07** Gỡ JOIN `users` khỏi `audit` — đi qua `UsersApiService` *(+ cổng tĩnh mới cho SQL thô)*
- [x] **A-08** ~~Dashboard đọc `expiry.warning_days`~~ → **dashboard thôi biết gì về cửa sổ**; một chủ, một con số
- [x] **F-02** 6 chốt `isLoading` + `data!` → `if (!q.data)`
- [x] **F-04** `shared-kit.css:170` → `box-shadow: var(--ring)` (14 chỗ khác đã đúng) *(+ cổng mới `token-usage.test.ts`: token dùng đúng KIỂU, không chỉ đúng tên)*
- [x] **F-05** ~~`select.tsx` so nội dung `options`~~ → phụ thuộc vào **chỉ mục** option đang chọn (một SỐ), rẻ và hẹp hơn băm cả danh sách
- [x] **F-07** `vault-panel`: đưa chốt `isAdmin` lên trước `verdict.isLoading/isError`; "Đang chờ duyệt" đọc state thật *(vế (a) là lỗi thật; vế (b) KHÔNG tới được — xem 20.2)*
- [x] **F-10** ~~`subnet-detail.tsx:289`~~ → lỗi đã DỜI XUỐNG API (`ip-address.service.ts:143`); vá bằng `keepPreferredByAddress` — xem 20.1

### 8.4 Dữ liệu & vận hành (7)

- [x] **D-02** Một dòng `sweep.register(purgeOld)` — ~~54.904 phiên chết đang nằm đó~~ → **ĐÃ LÀM 21/09**. Kèm luôn retention cho `outbox` (mục hoãn). Đo lại 21/09 thì con số KHÁC sổ: outbox 69.583 (100% đã xử lý), sessions 67.394 nhưng chỉ **1** hàng quá 30 ngày — lượt gieo 200k hồ sơ đẻ ra toàn hàng mới. Lỗ vẫn nguyên vì nó là lỗ CẤU TRÚC: `purgeOld()` có sẵn, chú thích ghi "Gọi từ sweep", và không ai gọi. Ngưỡng vào `system_config` (`0051`), không viết cứng
- [ ] **D-03** CHECK cho `approval.state`/`kind`/`subject_type`
- [ ] **D-04 + D-05** Một FK chung cho `department`/`isp_provider`/`service_port`: `ON UPDATE CASCADE ON DELETE RESTRICT`
- [x] **M-03** Handler `outbox-purge` — **ĐÃ LÀM 21/09** cùng D-02, migration `0051`. *(Ô này suýt bị bỏ quên: tôi tick D-02 và mục hoãn nhưng sót M-03, tuy cả ba nói về cùng một handler. Đúng lớp lỗi mà mục 8.9 vừa dọn — một việc nằm ở ba chỗ thì tick hai chỗ trông đã xong.)* Đo lại 21/09: 69.583 hàng, không phải 56.507
- [ ] **B-06** Tách hai nguyên nhân trong `mail.consumer.ts:36-40`: thiếu mẫu = lỗi, hồ sơ đã xóa = vô hại
- [ ] **B-15** `UPDATE system_config SET value = '20' WHERE key = 'login.rate_limit_per_ip'`
- [ ] **B-08 / T-02** Bỏ nút CTA khỏi hai email cảnh báo bảo mật (đang dẫn tới 404)

### 8.5 Dọn — mỗi ô một commit (6)

- [ ] **Lượt 1** CSS chết: L-11..L-16 + 3 cụm bonus + `filters.css` + `profile.css` + `shell.css:71-194` → **~550 dòng**
- [ ] **Lượt 2** Chú thích nói đúng về code: L-24 · L-26 · L-27 · L-28 · L-32 · F-06
- [ ] **Lượt 3** L-03 → L-10 về `lib/i18n`, **rồi mới** L-02
- [ ] **Lượt 4** L-21 · L-22 · L-23
- [ ] **Lượt 5** L-18 · L-19
- [ ] **Lượt 6** L-17 — cả 3 chỗ; dọn màu TRƯỚC, nới `gate-hex.sh` SAU

### 8.6 Văn bản & trợ năng (10)

- [ ] **T-01** 6 chuỗi tiếng Anh trong `ui/time-picker.tsx` (2 khóa đã có sẵn)
- [ ] 5 khái niệm mang hai tên (4.2) — bắt đầu từ `ipam.addressVoided` vì nó **nói sai việc vừa làm**
- [ ] `accounts.statusDisabled` → `'Đã vô hiệu hóa'` (đang trùng y hệt nút)
- [ ] `Member`/`Admin` trong câu tiếng Việt → `Thành viên`/`Quản trị`
- [ ] 4 màn tách câu rỗng "chưa có gì" khỏi "lọc không ra"
- [ ] **B-01** Gấp dấu tiếng Việt: hàm dùng chung cho web + `unaccent` (hoặc cột sinh) cho 11 chỗ `ilike`
- [ ] **B-02** `/admin/accounts` dùng `useListUrlState`
- [ ] **B-03** `document.title` theo màn
- [ ] **B-04** Chip "Đã ẩn" riêng, đừng đếm vào "Trống"
- [ ] **B-05** Ẩn `ExpiryBadge` cho hồ sơ `retired`
- [ ] **F-06 nhóm a11y** `Loading` thành vùng sống thường trực · drawer 390px quản lý tiêu điểm · `Field` nối `htmlFor` (thêm prop `id` cho `Combobox`) · `aria-describedby` cho `hint`/`error`

### 8.9 SÓT KHỎI CHECKLIST — bổ sung 21/09/2026 (16)

Mười sáu mã lỗi được ghi trong các mục chuyên môn (§1 · §6 · §11 · §13) mà **chưa bao giờ có
một ô tick nào** ở mục 8. Chúng không bị bỏ qua có chủ ý — chúng chỉ đơn giản không được chép
sang đây, nên mọi lượt đếm "còn bao nhiêu việc" từ trước tới nay đều thiếu.

Tìm ra bằng cách đối chiếu máy móc: lấy mọi mã `X-nn` xuất hiện trong cả sổ (52), trừ đi tập
mã có mặt trong mục 8 (36). Không phải bằng cách đọc lại — đọc lại là thứ đã bỏ lọt chúng
suốt ba ngày.

**Bài học, và nó lớn hơn 16 dòng dưới đây:** một checklist chép tay từ các bảng finding sẽ
thiếu, và cái thiếu đó vô hình vì checklist trông vẫn đầy đủ. Cùng đúng hình dạng "cổng khớp
đúng số không chuỗi" đã gặp bốn lần ở phần mã nguồn — lần này nạn nhân là chính cuốn sổ.

#### Chặn phát hành

- [x] **N-01** **CHẶN** — ĐÃ LÀM 21/09 (commit `eb2cdef`). Phân trang máy chủ cho `/expiry`;
  phép lọc theo nhóm và phép sắp cột cũng xuống server cùng chuyến, vì cả hai chú thích tại chỗ
  đều nói chúng chỉ đúng *khi màn không phân trang*. Dashboard thôi kéo 7.662 bản ghi để bày 8
  dòng. Thứ tự bắt buộc ở server: đếm cả kho → lọc nhóm → cắt trang
- [ ] **N-01b** Phân trang tận GỐC — `registry.collect()` vẫn hỏi trọn cửa sổ từ mọi nguồn rồi
  mới sắp/lọc/cắt. Bản vá 21/09 bỏ được phần đắt nhất đã đo (tuần tự hoá 7.662 bản ghi, đẩy qua
  dây, 841k node DOM) nhưng KHÔNG bỏ chi phí truy vấn ở các nguồn. Cắt tận gốc đòi đổi hợp đồng
  `ExpirySource.findExpiring(from, to)` cho mọi module đã đăng ký (AD-7) + một phép trộn k-đường
  có thứ tự giữa các nguồn — **một story, không phải một bản vá**
- [ ] **N-01c** `?sort=` ở server cho `/expiry`. Sắp cột ở client đã tắt 21/09 (nó chỉ đảo chỗ
  trang đang xem). Thứ tự hiện tại — gấp nhất lên đầu — là câu trả lời đúng cho màn này, nên đây
  là việc NHẸ; chỉ làm nếu có người thật sự cần sắp theo cột khác

#### Đúng đắn — VỪA

- [ ] **B-07** API tự dựng **8 đường dẫn tiếng Việt bản cũ** (`/thiet-bi/`, `/phan-mem/`,
  `/duong-truyen/`, `/dia-chi-ip/`) trong khi `web/src/lib/routes.ts` tự khai là "NGUỒN DUY
  NHẤT" và quyết định 26/08 là URL tiếng Anh. Những đường này đi vào **email** gửi ra ngoài
- [ ] **B-09** Member mở được **vỏ** của `/admin/accounts` và `/admin/vault-access`: đủ `h1`,
  phụ đề, và **nút "Thêm tài khoản" bấm được**, rồi mới báo không có quyền. Dữ liệu không rò
  (API 403 sạch) nhưng `/vault` và `/dev/components` chặn đúng bằng 404 — hai cửa lệch nhau
- [ ] **F-08** `attachment-panel.tsx:103` đọc `queryClient.getQueryData(ME_KEY)` **không
  subscribe**, mà `useApiMutation` invalidate `ME_KEY` sau MỌI mutation ⇒ Admin mất nút Xoá và
  component không re-render khi cache về. Chú thích `:98` khẳng định "`me` luôn có sẵn" — một
  giả định, không phải hàng rào
- [ ] **F-09** **AD-15 — 5 bản sao của `display()`+`describe()` panel Lịch sử, và chúng ĐÃ
  trôi lệch**: `isp:62` có `if (field.endsWith('Id')) return t('history.changedOnly')` mà bốn
  bản kia không có → sửa `siteId` ở màn NAT **in nguyên một UUID** ra màn hình

#### Nhẹ

- [ ] **N-02** `/nat` (800 dòng) · `/disposal` (582 dòng) chưa phân trang — §14.5 **hạ từ VỪA
  xuống NHẸ** sau khi đo ở 200k: hai màn này vẫn lành. Xử khi tiện
- [ ] **N-03** `dashboard` là API chậm nhất (327ms ở 30k → 855–1.111ms ở 200k). Chưa đau; đặt
  mốc xem lại ở 500k
- [ ] **B-10** `app-shell.tsx:113-122` — `aria-disabled` trên `<span>` không `role` **không có
  nghĩa**; mục "sắp có" thành node chữ trần với trình đọc màn hình, lời giải thích nằm duy
  nhất trong `title=` (chỉ mở được bằng chuột)
- [ ] **B-11** Nhãn cột ở 390px thừa hưởng font mono của ô (`table-stack td::before` không đặt
  lại `font-family`)
- [ ] **B-12** `device-detail.tsx` — hai tiêu đề chồng nhau cho cùng một bảng: "LICENSE ĐANG
  CÀI" rồi ngay dưới "PHẦN MỀM ĐANG CÀI (2)"
- [ ] **B-13** Thẻ "SỰ CỐ TUẦN QUA" nói cùng một điều hai lần
- [ ] **B-14** Thẻ dải đã tắt hiện `void_reason` **không nhãn** (đọc như số rác) và **thiếu
  `voided_by`** — trái luật tự đặt ở `EPIC-MAP.md`: "nói rõ **ai** tắt, khi nào, vì sao"
- [ ] **B-16** Vùng cuộn ngang giấu nội dung — 1/15 màn
- [ ] **B-17** `/admin/vault-access` — chú giải ký hiệu nằm DƯỚI bảng, sau 60 dấu `–`
- [ ] **B-18** Thiếu "Xuất Excel" ở `/service-accounts` · `/disposal` · `/admin/accounts` ·
  `/approvals` trong khi 6 màn danh sách khác đều có
- [ ] **B-19** `/admin/catalog` — mười điều khiển chen trên một hàng, gần kín 1280px

### 8.7 Định danh tiếng Việt — 6 đợt (mục 3.2)

- [ ] Đợt 0 cổng → [ ] Đợt 1 mặt tiền (9) → [ ] Đợt 2 sản phẩm (38) → [ ] Đợt 3 tên tệp (15) → [ ] Đợt 4 test (~92) → [ ] Đợt 5 `di-khap-giao-dien` (83) → [ ] Đợt 6 siết `error`

### 8.8 Chỉ số (index) & quy mô — bổ sung 20/09/2026

> Mục này **không có trong bản đầu** của checklist: §8.1–8.7 viết trước khi đo 200k và 1M.
> Số liệu ở §14 và §15.

**Gốc rễ đo được:** `*_SORT_KEYS` cho phép người dùng bấm tiêu đề cột để sắp xếp, nhưng
**16 trong số các cột ấy trên 4 bảng nghiệp vụ không có index dùng được**. Ở 1 triệu dòng, một
cú bấm vào "Tên thiết bị" = **340ms** ở trang 1 và **1.949ms** ở trang sâu, kèm **228 MB tràn
ra đĩa**. Có index: **0,083ms**.

Lưu ý đọc bảng: index **partial** (`WHERE status <> 'retired'`) **không dùng được cho
`ORDER BY`** trừ khi câu truy vấn mang đúng điều kiện ấy — mà `list()` thì không phải lúc nào
cũng mang. Index trên `lower(serial)` cũng không phục vụ `ORDER BY serial`.

#### Cột sắp xếp được nhưng thiếu index

- [ ] **`device`** — `(name, id)` · `(assigned_to, id)` · `(serial, id)` · `(warranty_end, id)` *(bản không partial; giữ cả bản partial cho màn Sắp hết hạn)*
- [ ] **`software`** — `(name, id)` · `(seat_total, id)` · `(start_date, id)` · `(status, id)` · `(end_date, id)` *(không partial)*
- [ ] **`service_account`** — `(name, id)` · `(status, id)` · `(kind, id)` *(không partial)*
- [ ] **`isp_line`** — `(hotline, id)` · `(contract_no, id)` · `(status, id)` · `(end_date, id)` *(không partial)*
- [ ] `users` — **cố ý BỎ QUA**: bảng này là danh sách nhân sự IT nội bộ, sẽ luôn dưới vài trăm dòng. Ghi ra để lượt rà sau không báo lại.

Kèm `id` làm cột thứ hai để thứ tự **ổn định** (hai hàng cùng `name` mà không có tie-breaker
thì trang 2 có thể lặp lại một dòng của trang 1) và để mở đường cho keyset sau này.

#### Tìm kiếm — một migration cho cả đúng đắn lẫn tốc độ

- [ ] `CREATE EXTENSION unaccent` + hàm bọc `ims_norm(text)` **IMMUTABLE** (bắt buộc — `unaccent()` là STABLE nên không index trực tiếp được; phải truyền tên từ điển tường minh `'public.unaccent'`)
- [ ] Cột sinh `search_norm` + `CREATE INDEX CONCURRENTLY … USING gin (search_norm gin_trgm_ops)` cho **`device` · `software` · `service_account` · `isp_line` · `nat_rule`**
- [ ] Đổi `buildWhere` của 5 module: bốn `ILIKE` → một `search_norm LIKE ims_norm(…)`

Đo trên 1 triệu hàng: **951ms / 0 kết quả (SAI)** → **241ms / 83.333 kết quả (ĐÚNG)**. Chi phí
86 MB index. **Đây cũng là lượt để diễn tập `ims:no-transaction` + `CREATE INDEX CONCURRENTLY`**
— bộ máy đã viết sẵn trong `migration-runner.ts` và chưa dùng lần nào (M-7).

#### Đếm tổng và phân trang

- [ ] Trần cho `count(*)` theo đúng khuôn **đã có** ở `audit-query.service.ts:123-148`
      (`SELECT count(*) FROM (SELECT 1 … LIMIT 10001)`, hiện "10.000+"). Đo: **184ms → ~1ms**,
      và nó chạy **mỗi lượt mở trang**
- [ ] Keyset cho `‹` `›` (giữ `OFFSET` cho nhảy số trang). Đo: **456ms → 0,099ms**, hằng số
- [ ] Cửa sổ số trang `1 … 4 5 [6] 7 8 … 50000` + ô nhảy trang — **≤ 9 nút bất kể tổng số trang**

#### Index nên GỠ hoặc SỬA (từ mục 5)

- [ ] **`DROP INDEX audit_log_actor_trgm`** — 11 MB GIN trên bảng ghi nóng nhất, **0 lượt quét/28 ngày**; `EXPLAIN` cho thấy planner không bao giờ chọn nó
- [ ] `device_port` — thêm UNIQUE `(connected_device_id, connected_port)`: AD-14 nói "một bản ghi/kết nối" nhưng **không chỗ nào ép**
- [ ] `department` · `isp_provider` · `service_port` — thêm FK `ON UPDATE CASCADE ON DELETE RESTRICT` (D-04/D-05: hiện **0 FK nào trỏ tới**, nên `CatalogService.remove()` luôn thành công và để lại chuỗi mồ côi)
- [ ] **GIỮ** cặp `audit_log_actor_idx` + `actor_action_at_idx` — L-30 nghi chúng trùng, nhưng đo ra 554 và 865 lượt quét, cả hai Index Only Scan. **Đóng mục L-30.**

#### Quy mô dài hạn (10-20 năm)

- [ ] **Phân vùng `audit_log`** theo `created_at` (`PARTITION BY RANGE`) — ~231k dòng/28 ngày ⇒ ~3 triệu/năm, và trigger append-only khiến **không tồn tại đường xoá nào được hỗ trợ**. `DETACH PARTITION` là lối duy nhất không phá NFR-03. Làm lúc bảng 50 GB đắt hơn nhiều
- [ ] **Vòng đời cho hồ sơ quá hạn** — ở 1M thiết bị có **213.333** hồ sơ đã quá hạn tích luỹ. Rổ này tăng theo *thời gian*, không theo số máy; không có đường ra thì màn Sắp hết hạn không bao giờ cứu được bằng phân trang đơn thuần
- [ ] Đo `listAll` (Xuất Excel, **không phân trang**) trước khi ai bấm nút đó trên dữ liệu thật — DB trả 1M hàng mất 58ms, nhưng `decorate()` + dựng xlsx trong Node **chưa ai đo**
- [ ] Chỉnh Postgres cho đúng phần cứng (`shared_buffers` 128 MB → ~25% RAM, `random_page_cost` 4 → 1.1, `effective_io_concurrency` 1 → 200). **Đo được: KHÔNG sửa được gì trong các câu đã chậm** — nâng `work_mem` 4 MB→256 MB còn làm câu sort **chậm hơn** (1.992ms → 2.592ms). Làm cho đúng, đừng dùng thay cho index


---

## 9. Nếu chỉ làm được năm việc

1. **A-01** — một dòng ở DTO. Hôm nay bất kỳ Member nào cũng thanh lý được một máy đang giữ
   IP, NAT và ghế license, và lượt đó **không hiện trong nhật ký thanh lý**.
2. **F-03 `--max-warnings=0`** — rẻ nhất, và nó bắt **F-01** miễn phí. Không có nó thì bản vá
   sau lại chết đúng kiểu bản vá trước.
3. **B-01 gấp dấu tiếng Việt** — thứ mọi người dùng chạm vào mỗi ngày. Hàm đã có sẵn trong
   repo, chỉ chưa ai dùng chung.
4. **B-08 / T-02** — nút trong hai email **cảnh báo bảo mật** dẫn tới 404, đúng lúc cần nhất,
   và thư đã gửi thì không thu lại được.
5. **Lượt dọn CSS (8.5 lượt 1)** — ~550 dòng, rủi ro gần bằng 0, và nó **đóng lại mục 11** mà
   anh hỏi riêng.

## 10. Một nhận xét về chính bộ sổ

Ba lượt rà trước đều tìm ra thứ thật. Nhưng lượt này đo được: **30/32 mục LOW còn nguyên**,
và **sáu cơ chế mới viết đúng-chú-thích-hay-không-bao-giờ-chạy**, trong đó **một cái là bản vá
của chính đợt 19/09** (F-01). Vấn đề không nằm ở khả năng tìm lỗi — nó rất tốt — mà ở chỗ
**điều gì buộc một finding phải chết**.

Bằng chứng gom lại:

- `exhaustive-deps` chỉ `warn` và cổng web không `--max-warnings=0` → F-01 đi qua.
- Không cổng nào canh CSS chết → ~550 dòng, trong đó **~168 dòng chết từ ngày đầu vào repo**.
- Không cổng nào canh `var(--token)` dùng sai thuộc tính → F-04 sống lặng lẽ.
- Bài kiểm đọc source **không lột chú thích** → A-09 (và `vault-surface.spec.ts` đã vá đúng
  lớp lỗi này **cùng ngày**, chỉ sót file bên cạnh).
- Cửa canh khoá i18n chết bị hai template quá rộng vô hiệu cho **118 khoá** → T-03.
- Job `e2e` trong `.github/workflows/ci.yml` **bị comment toàn bộ** (dòng 107-151) → DoD gạch 7
  chỉ còn ràng buộc duy nhất là anh nhớ chạy `--e2e`.

Nói ngắn: **repo này giỏi tìm lỗi hơn là giỏi giữ lỗi ở trạng thái đã sửa.** Mục 8.2 là chỗ
đáng bỏ công nhất, vì nó làm mọi mục còn lại rẻ đi và không quay về.

---

## Phụ lục — hiện vật và thay đổi của lượt rà này

**Hiện vật** (thư mục nháp của phiên, không nằm trong repo): 63 ảnh màn hình
(21 màn × sáng/tối/390px) · 21 cây trợ năng · `report.json` (kiểm kê a11y từng màn) ·
`interactions.json`, `deep.json`, `chot.json` (kết quả bấm thật) · `report-backend.md` (740 dòng).

**Đã đụng vào gì:** bốn file `e2e/tests/zz-ra-soat-*.spec.ts` dựng tạm để lái trình duyệt,
**đã xoá**; `git status` sạch, chỉ còn chính file này là mới. `docker compose exec api node
scripts/reset-e2e.mjs users` chạy 4 lần để trả tài khoản E2E về trạng thái gốc — đó là vùng dữ
liệu của bộ kiểm, không phải dữ liệu thật. **Không sửa một dòng mã sản phẩm nào.**

**Một điều chưa làm được:** DB dev hiện gần trống (1 thiết bị, 2 phần mềm, 1 dải, và tên đều là
`1`/`2`), nên phần đánh giá bố cục ở trạng thái **nhiều dữ liệu** — bảng dài, cột tràn, phân
trang thật, bản đồ quan hệ nhiều nhánh — chưa đo được. Muốn có thì gieo `docs/mau-du-lieu/` rồi
đi lại lượt 1; nhớ thứ tự **chạy E2E trước, gieo demo sau**.

---

## 11. Lượt năm — bố cục desktop, chữ bị cắt, vị trí nút

Đo trên 15 màn × **hai khổ**: 1440px và **1280px** (khổ laptop công ty hay dùng). Tìm: vùng
cuộn ngang có bao nhiêu px bị giấu · chữ bị chém không dấu hiệu · nút chính đứng thứ mấy trong
luồng Tab · nút nào nằm cạnh tiêu đề.

### 11.1 Kết quả

| Phép đo | Kết quả |
| --- | --- |
| Chữ bị chém không ellipsis, ở 1440px | **0/15 màn** |
| Chữ bị chém không ellipsis, ở 1280px | **0/15 màn** |
| Vùng cuộn ngang giấu nội dung | **1/15 màn** (xem B-16) |
| Số lần Tab trước khi vào nội dung | **18** trên mọi màn — nhưng link "Bỏ qua menu" là Tab **đầu tiên** và chạy đúng |

### 11.2 Lỗi mới

| # | Mức | Chỗ | Chuyện gì |
| --- | :---: | --- | --- |
| **B-16** | VỪA | `/admin/vault-access` — `div.table-wrap.access-grid-wrap` | **Hơn nửa bảng nằm ngoài màn hình.** Bảng rộng 2253px: ở 1440px giấu **1093px**, ở 1280px giấu **1253px** — tức **11/20 nhóm quyền** (Server · Switch · Thiết bị khác · UPS · SSL · Hợp đồng bảo trì · Khác · License · Tên miền · Dùng chung · VPN) **không thấy được nếu không cuộn ngang**, và không có dấu hiệu nào nói chúng tồn tại. Đây là màn "bản đồ phòng thủ" — thứ người ta mở ra để trả lời *"ai xem được cái gì"* — nên nửa bảng vô hình là vấn đề thật, không phải thẩm mỹ. Hướng sửa: xoay trục (mỗi nhóm một dòng), hoặc gộp theo cột cha có thể bung/gập, hoặc ít nhất một chỉ báo "còn 11 cột nữa →" |
| **B-17** | NHẸ | `/admin/vault-access` | **Chú giải ký hiệu nằm DƯỚI bảng.** Người đọc lướt qua 60 dấu `–` rồi mới tới dòng *"✓ Xem thẳng · ⏳ Cần duyệt · – Không có quyền"*. Đưa lên trên bảng |
| **B-18** | NHẸ | `/service-accounts` · `/disposal` · `/admin/accounts` · `/approvals` | **Thiếu "Xuất Excel" trong khi 6 màn danh sách khác đều có** (Thiết bị · Phần mềm · Đường truyền · Sắp hết hạn · Địa chỉ IP · Sổ NAT). Kho thanh lý và Tài khoản dịch vụ đúng là thứ người ta hay phải gửi ra ngoài (kiểm kê, kiểm toán). Hoặc thêm cho đủ, hoặc ghi lý do vì sao bốn màn này cố ý không có |
| **B-19** | NHẸ | `/admin/catalog` | **Mười điều khiển chen trên một hàng cạnh tiêu đề**: 3 nút hành động (Tải file mẫu · Nhập từ Excel · Thêm site) + 7 tab (Site · Tủ mạng · Loại thiết bị · Nhà cung cấp · Bộ phận · Nhà mạng · Dịch vụ / Port). Ở 1280px hàng này gần kín chiều ngang |

### 11.3 Điều đo được là ĐÚNG — ghi lại để khỏi rà lại

- **Vị trí nút nhất quán trên 10 màn danh sách:** phụ (Xuất Excel / Tải file mẫu / Nhập từ
  Excel) rồi mới tới nút chính (Thêm …), tất cả nằm ngang tiêu đề, và nút chính **luôn** là
  nút cuối cùng trước thanh lọc. Trang chi tiết cũng vậy: `Sửa hồ sơ` rồi `Thanh lý`.
- **Link "Bỏ qua menu, vào thẳng nội dung" là thứ gánh cả bàn phím ở đây** — 18 điểm dừng Tab
  trong sidebar là nhiều, nhưng skip-link đứng đầu và đưa tiêu điểm thẳng vào `main#noi-dung`
  (đã bấm thật). Đừng bao giờ bỏ nó.
- **Không một chữ nào bị chém** ở cả 1440 lẫn 1280 trên 15 màn.

### 11.4 Hai lần tôi suýt báo sai — và cách tránh

Ghi ra vì nó là bài học đo đạc, không phải lỗi sản phẩm:

1. **60 ô "–" và 7 nút "⋯" trông như trùng tên.** Phép đo đầu của tôi lấy `textContent`. Tên
   **khả truy cập** thật là `"E2E Thành viên — Thiết bị loại Camera: Không có quyền"` và
   `"Thao tác với Cao Thuấn"`. Màn này làm trợ năng **rất tốt**.
2. **Ô số KPI trông như dính chữ** (`"0Đã quá hạn"`). Lại là `textContent`. Cây trợ năng thật
   cho `button "0 Đã quá hạn"` — **có dấu cách**, vì `.kpi-n`/`.kpi-l` là hai node block.

> **Luật rút ra cho lượt rà sau: `textContent` KHÔNG phải tên khả truy cập.** Muốn nói về
> trình đọc màn hình thì phải đọc `ariaSnapshot()` / `getByRole(name)`, không phải `innerText`.
> Cả hai lần trên, nếu tin phép đo đầu thì báo cáo sẽ vu oan cho đúng những chỗ làm tốt nhất.

---

## 12. Đợt 1 + 2 của mục 3 — ĐÃ LÀM trong chính lượt này (19/09/2026)

Không còn là kế hoạch. **47 định danh tiếng Việt trong mã sản phẩm đã đổi sang tiếng Anh**,
trên 16 tệp. Không sửa một dòng logic nào — diff đọc được là "chỉ đổi tên".

### 12.1 Đã đổi gì

| Cũ | Mới | Tệp |
| --- | --- | --- |
| `coHopThoaiDangMo` · `useCoHopThoaiDangMo` | `isAnyDialogOpen` · `useAnyDialogOpen` | `ui/dialog.tsx` (+ 2 nơi gọi) |
| `soHopDangMo` · `nguoiTheoDoiHop` · `dangKyTheoDoiHop` · `bao` | `openDialogCount` · `dialogSubscribers` · `subscribeToDialogs` · `notify` | `ui/dialog.tsx` |
| `banDau` · `chuKyCacO` · `o` · `gia` · `dangHoi` · `thuDong` · `laHopLong` | `initialSignature` · `fieldSignature` · `field` · `value` · `asking` · `tryClose` · `isNested` | `ui/dialog.tsx` |
| `moTimNhanh` · `SU_KIEN_MO_TIM_NHANH` | `openCommandPalette` · `OPEN_PALETTE_EVENT` | `ui/command-palette.tsx`, `shell/app-shell.tsx` |
| `dangChon` · `chon` · `toi` · `kep` · `cu` · `moi` · `den` | `anchoredTo` · `select` · `to` · `clamped` · `previous` · `next` · `target` | `ui/command-palette.tsx` |
| `nhomHong` · `nhomKetQua` · `cuoi` · `mucs` · `ten` · `nhom` · `coHopThoai` · `onMo` | `failedGroups` · `resultGroups` · `last` · `items` · `name` · `group` · `dialogOpen` · `onOpen` | `ui/command-palette.tsx` |
| `chuaBiet` · `dangTai` | `isUnknown` · `isLoading` | `relation-map.tsx`, `device-detail.tsx`, `relation-map-disclosure.test.tsx` |
| `nenLocSanDangCap` | `shouldIsolateAssigned` | `slot-paging.ts`, `slot-paging.test.ts`, `subnet-detail.tsx` |
| `nguongTruyenVao` · `dangGo` · `khuRong` | `thresholdsProp` · `previous` · `moduleEnabled` | `ui/expiry-badge.tsx`, `ui/use-list-url-state.ts`, `device-detail.tsx` |
| `khoa` | `key` | 5 tệp `*-history-entries.ts` |
| `maLoiCua` · `than` · `ma` · `loiGhi` | `errorCodeOf` · `body` · `code` · `writeError` | `api/.../vault.controller.ts` |
| `soLuot` · `dem` | `attemptCount` · `counted` | `api/.../security-probe.service.ts` |
| `soDau` · `ten` · `so` · `ds` · `di` · `duongDan` · `cau` · `con` | `firstNumberIn` · `label` · `limit` · `allowed` · `walk` · `path` · `message` · `child` | `api/src/common/validation-messages.ts` |
| `thuTu` | `order` | `api/scripts/reset-e2e.mjs` |

Sửa kèm (DoD gạch 4): `docs/SHARED-REGISTRY.md` và `docs/EPIC-MAP.md` đã cập nhật tên mới.

**Một quyết định vượt ra ngoài danh sách:** giá trị chuỗi DOM `'ims:mo-tim-nhanh'` cũng đổi
thành `'ims:open-command-palette'`. Sổ nợ khuyên chỉ đổi tên hằng cho an toàn — nhưng
`grep` cả `web/src` lẫn `e2e/` chứng minh **`dispatchEvent` và `addEventListener` đều nằm
trong duy nhất `command-palette.tsx`**, không nơi thứ ba nào biết chuỗi ấy. Để lại một chuỗi
tiếng Việt sau khi đã đổi tên hằng là làm nửa việc.

### 12.2 Đã chứng minh bằng gì

| Cổng | Kết quả |
| --- | --- |
| `npm --prefix web run build` (**cổng kiểu THẬT** — `tsc --noEmit` ở `web/` kiểm 0 tệp) | ✅ |
| `npm --prefix api run build` | ✅ |
| `npm --prefix api run lint` · `npm --prefix web run lint` + depcruise | ✅ 0 error (cảnh báo giữ nguyên 1 và 30 như trước khi đổi) |
| Jest | ✅ **893/893** |
| Vitest | ✅ **364/364** |
| `npm --prefix e2e run typecheck` | ✅ |
| **Bài đột biến** — đổi `>=` thành `>` trong `shouldIsolateAssigned` | ✅ `slot-paging.test.ts` **ĐỎ** (1 failed / 25), rồi trả lại. Chứng minh bài kiểm vẫn dính vào hàm sau khi đổi tên |
| `docker compose build` + **xác minh hiện vật** (`curl / \| grep static/index-` = `index-CMZN456z.js` khớp `web/dist/`) | ✅ không chạy trên ảnh cũ |
| **Playwright trên stack thật** — `di-khap-giao-dien` + `vault-reveal` + `device-detail` + `ipam` | ✅ **94/94** (9,9 phút) |
| `reset-e2e.mjs users` sau khi đổi `thuTu`→`order` | ✅ exit 0 |

### 12.3 Bẫy đã dính và cách thoát — đáng nhớ hơn danh sách trên

**`sed -i` trong Git Bash trên Windows NUỐT CRLF của cả tệp.** Sáu tệp (`dialog.tsx`,
`device-detail.tsx`, `subnet-detail.tsx`, `app-shell.tsx`, `reset-e2e.mjs`,
`SHARED-REGISTRY.md`) bị viết lại toàn bộ dòng: diff phình từ ~180 lên **3093 dòng**. Nội dung
đúng, nhưng một diff như thế thì không ai soi được, và nó chôn 47 thay đổi thật vào giữa 3000
thay đổi giả.

Cách phát hiện: `git diff --stat` — tệp nào đổi vài tên mà báo 2052 dòng thì không phải đổi tên.
Cách thoát:

```bash
for f in $(git diff --name-only); do
  orig=$(git show "HEAD:$f" | tr -cd '\r' | wc -c)
  now=$(tr -cd '\r' < "$f" | wc -c)
  if [ "$orig" -gt 0 ] && [ "$now" -eq 0 ]; then sed -i 's/$/\r/' "$f"; fi
done
```

Chỉ đúng khi tệp gốc CRLF **đồng nhất** — kiểm trước bằng `tr -cd '\r' | wc -c` phải bằng
`tr -cd '\n' | wc -c`. Sau khi phục hồi: 180 dòng, đúng tỉ lệ.

**Và một bẫy nữa suýt dính:** `\bso\b` trong `sed` khớp cả chữ "so" của một câu **chú thích
tiếng Việt** (`validation-messages.ts:162`, "…và so câu đầu ra"). Mọi định danh ngắn
(`so`, `ten`, `o`, `gia`, `bao`, `cu`, `moi`, `den`) phải đổi bằng sửa CÓ NGỮ CẢNH, không phải
`sed` theo ranh giới từ. Đây đúng là điều sổ nợ cảnh báo cho Đợt 5 — và nó đã đúng ngay từ
Đợt 2.

### 12.4 Còn lại

| Nhóm | Số | Ghi chú |
| --- | :---: | --- |
| **B** — định danh trong mã kiểm thử | ~175 / 32 tệp | Đợt 4 (~92 tên, 30 tệp) rồi Đợt 5 (`di-khap-giao-dien.spec.ts`, 83 tên, một tệp) |
| **C** — tên tệp | 15 | Đợt 3 — `git mv`, giữ hậu tố `.mobile.spec.ts`, chốt sàn bằng `playwright test --list \| wc -l` trước/sau |
| **Đợt 0** — luật lint chặn tên mới | — | **Nên làm TRƯỚC đợt 4**: mỗi ngày chưa có cổng là một cơ hội sinh tên tiếng Việt mới |
| **D** — mô tả `describe`/`it` | 1261 | **Không đổi** (lý lẽ ở mục 3.3) |

### 12.5 Một việc vận hành đã xử luôn

`login.rate_limit_per_ip` trên DB dev đã trả về **20** (giá trị seed). Nó đang mắc kẹt ở 500
do một lượt E2E chết giữa chừng, tức hàng rào chống dò mật khẩu đang tắt — xem **B-15**. Đây
là lệnh `UPDATE` mà chính `global-teardown.ts` in ra mỗi lượt chạy.

---

## 13. Đo lại trên 30.000 hồ sơ (19/09/2026) — thứ DB trống không nói ra được

Mục 1 và 11 đo trên một DB gần trống (1 thiết bị, 2 phần mềm) và đã nói rõ đó là giới hạn.
Lượt này gieo dữ liệu thật bằng `ops/seed-demo.sql` rồi đo lại:

| Bảng | Số hàng |
| --- | ---: |
| `device` | **30.000** |
| `license_assignment` | **25.000** |
| `ip_address` | 5.040 (24 dải) |
| `software` | 2.000 |
| `nat_rule` | 800 |
| `service_account` | 600 |
| `cabinet` · `site` · `vendor` · `department` | 84 · 8 · 12 · 15 |

### 13.1 Kết luận ngắn: **CSDL không phải nút cổ chai, và bố cục đứng vững. Chỗ hỏng là màn không phân trang.**

| Màn | Mở trong | Dòng DOM | Phân trang | API chậm nhất |
| --- | ---: | ---: | --- | --- |
| Bảng điều khiển | 2.716ms | — | — | `dashboard` **327ms** |
| Thiết bị | 2.008ms | 20 | ✅ `1–20 trên 30001` | `devices?page=1` **29ms** |
| Phần mềm | 2.014ms | 20 | ✅ `1–20 trên 2002` | `software?page=1` **21ms** |
| **Sắp hết hạn** | **3.657ms** | **7.662** | ❌ **KHÔNG** | `expiry?withinDays=30` **272ms** |
| Địa chỉ IP | 2.579ms | 50 | ✅ | `ipam/subnets` 100ms |
| **Sổ NAT** | 2.096ms | **800** | ❌ **KHÔNG** | `ipam/nat` 92ms |
| Tài khoản dịch vụ | 2.047ms | 20 | ✅ `1–20 trên 600` | 17ms |
| **Kho thanh lý** | 1.994ms | **582** | ❌ **KHÔNG** | `disposal` 44ms |
| Chi tiết thiết bị | 2.172ms | — | — | `devices/:id/panels` 97ms |

Đo ở tầng CSDL (`EXPLAIN ANALYZE` trên 30k hàng): `count(*)` lọc trạng thái **3,4ms** ·
trang 1 của danh sách **0,13ms** (Index Scan trên `device_code_key`) · ILIKE bốn cột quét
tuần tự **48,7ms**. Phân trang sâu cũng lành: `/devices?page=1400` trả
`27981–28000 trên 30001 dòng` đúng 20 dòng.

**Bố cục giữ nguyên chất lượng dưới tải:** 0 chữ bị chém ở 1440px, 0 tràn ngang ở 390px trên
cả 8 màn. Phân trang hiện đúng số thật. Đây là kết quả tốt và nên ghi nhận.

### 13.2 Lỗi mới, chỉ lộ ra khi có dữ liệu

| # | Mức | Chỗ | Chuyện gì |
| --- | :---: | --- | --- |
| **N-01** | **CAO** | `web/src/features/expiry/expiry-screen.tsx` + `api/.../expiry.controller.ts:110` | **Màn Sắp hết hạn đổ 7.662 dòng vào MỘT bảng, không phân trang.** `grep -c Pagination` trên màn này = **0**, và `@Get()` của endpoint **không nhận `page`/`limit`** — nó trả trọn bộ kết quả của cửa sổ 30 ngày. Đo được: 3.657ms mở màn, chậm nhất trong tám màn, và con số này **tăng tuyến tính** theo số hồ sơ có hạn. Nặng thêm vì đây đúng là màn người ta mở mỗi sáng, và vì nới cửa sổ lên 90/180 ngày — thao tác mà chính câu gợi ý trên màn mời gọi — sẽ nhân số dòng lên tiếp |
| **N-02** | VỪA | `nat-screen.tsx` · `disposal-screen.tsx` | Cùng bệnh, nhẹ hơn vì dữ liệu ít hơn: **Sổ NAT 800 dòng**, **Kho thanh lý 582 dòng**, cả hai `grep -c Pagination` = 0. Ở quy mô một công ty thật thì sổ NAT vài nghìn rule là bình thường |
| **N-03** | NHẸ | `dashboard.service.ts` | `dashboard` là API chậm nhất toàn hệ thống (**327ms**) vì nó gom qua sáu `*.api.ts`. Chưa đau, nhưng nó nằm trên đường mở màn đầu tiên mỗi ngày và sẽ lớn theo dữ liệu |

### 13.3 B-01 — bằng chứng dứt điểm, không còn là suy luận

Ở mục 1.4 tôi báo B-01 (tìm kiếm không khớp tiếng Việt không dấu) dựa trên DB gần trống và
trên đọc code. Giờ đo trên dữ liệu thật:

| Gõ vào ô tìm của `/devices` | Kết quả |
| --- | ---: |
| `Máy trạm` | **2.500 dòng** |
| `may tram` | **0 dòng** — *"Chưa có thiết bị nào khớp bộ lọc."* |
| `phát sóng` / `phat song` | **2.500** / **0** |
| `máy chủ` / `may chu` | **2.500** / **0** |
| `DM-000123` (mã) | 1 dòng ✅ |
| `Catalyst` (model, không dấu sẵn) | 3.000 dòng ✅ |

**7.500 trên 30.000 thiết bị — một phần tư đội máy — vô hình với người gõ không dấu.** Và câu
màn hình trả lời không phải "không tìm thấy, thử bỏ dấu" mà là *"Chưa có thiết bị nào khớp bộ
lọc"*, tức nó khẳng định một điều sai. Đây không còn là mục "nên sửa" — với một hệ thống nội
bộ tiếng Việt, đó là chức năng tìm kiếm hỏng một phần tư.

### 13.4 Bài học từ chính lượt đo

**Bản đo đầu tiên timeout ở 25 phút, và thủ phạm là bài đo chứ không phải sản phẩm.** Ba thứ
cộng lại: một handler `page.on('requestfinished')` **bất đồng bộ** `await req.response()` cho
mọi request · `waitForLoadState('networkidle', 30s)` trên màn có polling · ảnh `fullPage` của
trang 7.662 dòng. Bản gọn — đọc `performance.getEntriesByType('resource')` **một lần** sau khi
tải xong, chờ `h1` thay vì chờ mạng im — chạy trọn trong **1,1 phút** và cho số chính xác hơn.

> Khi một phép đo hiệu năng báo "chậm", việc đầu tiên là hỏi phép đo có tự làm chậm mình không.
> Nếu tôi tin bản đầu, báo cáo này đã có một dòng "toàn hệ thống chậm dưới tải" hoàn toàn sai.

Và ba lần liên tiếp trong chính `ops/seed-demo.sql`, CHECK `end >= start` của `device`,
`software`, `license_assignment` bắt được lỗi cùng một kiểu: sinh hai mốc thời gian **độc lập**
cho cùng một hàng. Lược đồ làm đúng việc của nó — đây là điểm cộng cho mục 5, không phải phàn nàn.

### 13.5 Dữ liệu demo — luật sử dụng

`ops/seed-demo.sql` gieo, `ops/unseed-demo.sql` gỡ. Hai luật:

1. **Không hàng nào mang chữ `E2E`** (tiền tố dùng là `DM` / `DMS` / `DMSW` / `DMSA`). Đó là
   dấu DUY NHẤT `api/scripts/reset-e2e.mjs` nhìn vào để dọn.
2. **Chạy `unseed-demo.sql` TRƯỚC mỗi lượt E2E.** 30k thiết bị đẩy hàng của bài kiểm ra khỏi
   trang 1 — đúng sự cố 09/09 (27 dải + 11 hồ sơ phần mềm, 8 bài đỏ trông như hồi quy API) và
   11/09 (24 tài khoản).

---

## 14. Sau 5-6 năm: 200.000 hồ sơ — tìm kiếm và phân trang chịu được không?

Nâng dữ liệu demo lên **200.001 thiết bị · 100.002 lượt gán ghế · 10.002 phần mềm** rồi đo lại
cả ở tầng CSDL (`EXPLAIN ANALYZE` trên đúng câu mà `DevicesService.list()` sinh ra) lẫn ở
trình duyệt thật.

### 14.1 Câu trả lời ngắn

**Phân trang: không phải lo, kể cả trang cuối.** **Tìm kiếm: chạy được nhưng suy thoái tuyến
tính, và có một bản sửa rẻ chữa luôn cả lỗi không-dấu.** **Thứ sẽ gãy trước tiên không phải
tìm kiếm mà là ba màn không phân trang — và nó gãy ở mức không dùng được.**

| Thao tác | 30k | 200k | Đánh giá |
| --- | ---: | ---: | :---: |
| Danh sách trang 1 | API 29ms | API 55ms · màn 276ms | ✅ |
| **Trang 5.000** (giữa) | — | 908ms · DB 29ms | ✅ |
| **Trang 9.999** (cuối) | — | **970ms** · DB 74ms | ✅ **phẳng** |
| `count(*)` tổng (chạy mọi lượt mở trang) | — | DB 30ms | ✅ |
| Lọc theo site | — | DB **10ms** (`device_site_idx`) | ✅ |
| **Tìm kiếm** | DB 49ms | DB **207ms** · API **240–802ms** | ⚠️ tuyến tính |
| Sổ NAT (800 dòng) | 2.096ms | **582ms** | ✅ |
| Kho thanh lý (782 dòng) | 1.994ms | **380ms** | ✅ |
| Bảng điều khiển | API 327ms | API **855–1.111ms** | ⚠️ ~3× |
| **Sắp hết hạn · 30 ngày** | 3.657ms · 7.662 dòng | **24.959ms · 50.636 dòng · 506k node** | 🔴 |
| **Sắp hết hạn · 90 ngày** | — | **34.912ms · 64.117 dòng · 641k node** | 🔴 |
| **Sắp hết hạn · 180 ngày** | — | **77.142ms · 84.135 dòng · 841k node** | 🔴 |

### 14.2 Phân trang — lành, và lý do nó lành

`ORDER BY code` đi thẳng vào `device_code_key`, nên `OFFSET 199980 LIMIT 20` là một Index Scan
**74ms** — trang cuối của 200k chỉ đắt hơn trang đầu 74ms, không phải gấp bội. Đo ở trình duyệt:
trang 1 = 951ms, trang 9.999 = 970ms. **Chênh 19ms.**

Nghĩa là **chưa cần đổi sang keyset pagination** ("WHERE code > :last"). Mốc nên xem lại là
khoảng **1 triệu dòng**, hoặc sớm hơn nếu thêm một cột sắp xếp KHÔNG có index (lúc đó `ORDER BY`
sẽ phải sort toàn bảng và OFFSET sâu mới thật sự đau).

`count(*)` cho tổng số dòng — thứ chạy song song với mọi lượt mở trang — là **30ms** nhờ Parallel
Seq Scan. Ở 1 triệu dòng nó sẽ ~150ms; lúc đó mới cần cân nhắc đếm xấp xỉ.

### 14.3 Tìm kiếm — chạy được, nhưng đang trả giá hai lần

`buildWhere` sinh `code ILIKE '%x%' OR name ILIKE … OR serial ILIKE … OR model ILIKE …`.
`ILIKE '%…%'` **không dùng được index nào** ⇒ quét tuần tự toàn bảng. Và `list()` chạy
`Promise.all([rows, count])` ⇒ **mỗi lượt gõ là HAI lượt quét toàn bảng**, không phải một.

| Số dòng | DB cho một lượt tìm |
| ---: | ---: |
| 30.000 | 49ms |
| 200.000 | **207ms** |
| ~500.000 (ngoại suy tuyến tính) | ~520ms |
| ~1.000.000 | ~1.040ms |

Ở 200k thì 240–802ms vẫn chấp nhận được cho **một** người. Chỗ đau là **đồng thời**: mười người
cùng gõ ô tìm = hai mươi lượt quét toàn bảng song song, và Postgres chỉ có ngần ấy worker.

### 14.4 Bản sửa: MỘT migration chữa cả lỗi không-dấu lẫn suy thoái tuyến tính

Tôi đã **dựng thử và đo trên chính 200k hàng này**, rồi gỡ đi để DB dev không lệch khỏi
migration:

```sql
CREATE EXTENSION IF NOT EXISTS unaccent;

-- `unaccent()` là STABLE nên KHÔNG index trực tiếp được. Bọc IMMUTABLE, và phải truyền tên
-- từ điển tường minh ('public.unaccent') — đó là điều kiện để Postgres cho phép.
CREATE FUNCTION ims_norm(t text) RETURNS text
  LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
  AS $$ SELECT lower(public.unaccent('public.unaccent', t)) $$;

ALTER TABLE device ADD COLUMN search_norm text
  GENERATED ALWAYS AS (ims_norm(
    coalesce(code::text,'') || ' ' || coalesce(name,'') || ' ' ||
    coalesce(serial,'')     || ' ' || coalesce(model,'')
  )) STORED;

CREATE INDEX device_search_trgm ON device USING gin (search_norm gin_trgm_ops);
```

Rồi `buildWhere` đổi bốn `ILIKE` thành một: `search_norm LIKE ims_norm('%' || :q || '%')`.

**Kết quả đo được trên 200.000 hàng:**

| | Trước | Sau |
| --- | ---: | ---: |
| `may tram` (không dấu) | **0 kết quả**, 207ms | **16.666 kết quả**, **16,8ms** |
| `Máy trạm` (có dấu) | 16.666 kết quả, 207ms | 16.666 kết quả, **19,8ms** |
| Kế hoạch | Parallel Seq Scan | Bitmap Index Scan trên `device_search_trgm` |

**Nhanh hơn ~12 lần, và lần đầu tiên gõ không dấu ra đúng kết quả.** Chi phí: index **22 MB**
trên heap 61 MB, cộng một lượt tính `search_norm` mỗi lần ghi hồ sơ. Dựng index mất 2,7 giây ở
200k — nhớ `CREATE INDEX CONCURRENTLY` (bộ máy `ims:no-transaction` của `migration-runner` đã
viết sẵn cho việc này và **chưa từng được dùng lần nào**, xem mục 5.3 M-7 — đây đúng là lượt
để diễn tập nó).

`pg_trgm` **đã cài sẵn** (repo đang dùng ở `audit_log_actor_trgm`); `unaccent` có trong ảnh
Postgres, chỉ cần `CREATE EXTENSION`. Làm tương tự cho `software`, `service_account`,
`isp_line`, `nat_rule` — năm bảng, một khuôn.

> Đây là lý do nên gộp B-01 (đúng đắn) với hiệu năng tìm kiếm làm **một** việc: sửa riêng lẻ
> lỗi không-dấu bằng cách `unaccent()` hai vế lúc chạy sẽ làm tìm kiếm **chậm hơn nữa** vì hàm
> phủ lên cột thì càng không index được.

### 14.5 Thứ thật sự gãy: màn Sắp hết hạn (N-01 nâng từ CAO lên CHẶN)

Ở mục 13 tôi xếp N-01 mức CAO dựa trên 30k. Ở 200k nó là **không dùng được**:

- **30 ngày: 24,9 giây mở màn**, 50.636 dòng, **506.553 node DOM**, một lượt cuộn mất 6,6 giây.
- **180 ngày: 77,1 giây**, 84.135 dòng, **841.543 node DOM**.
- Truy vấn DB chỉ mất **10ms** (có `device_warranty_idx`). **100% chi phí nằm ở chỗ render.**

**Và đây mới là phần nguy hiểm nhất:** ở cửa sổ 30 ngày, DB chỉ có **6.477** thiết bị hết hạn
trong 30 ngày tới — nhưng màn vẽ **50.636** dòng. Phần chênh (~44.000) là hàng **ĐÃ quá hạn**
tích luỹ. Rổ "đã quá hạn" **không có trần và không bao giờ co lại**: hồ sơ quá hạn mà không ai
gia hạn hay thanh lý thì ở lại đó vĩnh viễn. Sau 5-6 năm nó chỉ có một chiều — tăng.

Nghĩa là **N-01 không tự khỏi khi công ty ngừng mua máy**; nó tăng theo *thời gian*, không theo
quy mô đội máy.

Hệ quả kèm theo, đo được: sau khi mở `/expiry` một lần, **màn kế tiếp cũng chậm theo** — lượt đo
`/nat` ngay sau đó ra 9.730ms, nhưng đo lại một mình thì chỉ **582ms**. Trình duyệt còn đang dọn
841k node. Một màn hỏng làm bẩn cả phiên làm việc.

**Hướng sửa, theo thứ tự đáng làm:**

1. **Phân trang máy chủ cho `/expiry`** — `@Get()` hiện không nhận `page`/`limit`. Đây là bản
   sửa đúng gốc và dùng lại đúng khuôn 6 màn khác đã có.
2. **Tách rổ "đã quá hạn" ra khỏi cửa sổ**, cho nó trần riêng và một hành động hàng loạt
   ("thanh lý N hồ sơ quá hạn > 1 năm"). Không có đường thoát thì rổ chỉ lớn lên.
3. Nếu muốn giữ cảm giác "một bảng duy nhất": ảo hoá dòng (`virtualized list`) — nhưng đó là
   bản vá cho triệu chứng, và nó không chữa 2,4 giây của lượt gọi API trả 84k bản ghi.

Cùng lúc đó, `/nat` (800 dòng) và `/disposal` (782 dòng) vẫn lành ở quy mô này — **N-02 hạ từ
VỪA xuống NHẸ**, xử khi tiện chứ không gấp.

### 14.6 Bảng điều khiển — theo dõi, chưa phải sửa

`dashboard` từ 327ms (30k) lên **855–1.111ms** (200k), tăng ~3× cho 6,6× dữ liệu — dưới tuyến
tính, nhưng nó nằm trên đường mở màn đầu tiên mỗi ngày và gom qua sáu `*.api.ts`. Ở 500k nó sẽ
chạm ngưỡng 2 giây. Đặt mốc xem lại chứ chưa cần làm gì hôm nay.

### 14.7 Hai lần phép đo suýt nói dối — và cách tôi bắt được

1. **"Tìm kiếm mất 60 giây."** `waitForResponse` của tôi chờ `q=` trong khi API dùng `search=`
   (web để `?q=` trên thanh địa chỉ, API nhận `search=` — hai tên cho một thứ). Nó timeout đúng
   60s và tôi suýt ghi "tìm kiếm sập ở 200k". Số thật: **240–802ms**.
2. **"Sổ NAT chậm gấp 5 lần."** 9.730ms — nhưng nó được đo NGAY SAU trang 841k node. Đo lại một
   mình: **582ms**.

> Cả hai lần, con số sai đều lớn hơn sự thật một bậc độ lớn và đều *nghe có vẻ hợp lý*. Quy ước
> cho lượt đo sau: **mỗi phép đo hiệu năng chạy từ trang trắng**, và không bao giờ chờ một URL
> đoán mò — chờ thay đổi quan sát được trên màn.

### 14.8 Kết luận cho câu hỏi "5-6 năm nữa thì sao"

| | Mốc bắt đầu đau | Việc cần làm |
| --- | --- | --- |
| Phân trang danh sách | **~1 triệu dòng** | Chưa cần làm gì. Xem lại nếu thêm cột sắp xếp không index |
| Tìm kiếm | **đã đau rồi về ĐÚNG ĐẮN**, hiệu năng ~500k | Một migration `unaccent` + `pg_trgm` — chữa cả hai, đo được 12× nhanh hơn |
| Bảng điều khiển | ~500k | Theo dõi |
| **Sắp hết hạn** | **ĐÃ GÃY ở 200k** | Phân trang máy chủ + tách rổ quá hạn. **Việc gấp nhất trong cả báo cáo này về mặt vận hành** |
| Xuất Excel | chưa đo | `listAll` không phân trang: DB trả 200k hàng mất 58ms, nhưng `decorate()` + dựng xlsx trong Node là phần chưa đo. **Cần đo trước khi ai đó bấm nút ấy trên dữ liệu thật** |

---

## 15. 1.000.000 dòng — và thiết kế cho 10-20 năm

Nâng `device` lên **1.000.001 hàng** (432 MB: 256 MB heap + 176 MB index) rồi đo từng hình dạng
truy vấn mà `DevicesService.list()` sinh ra.

### 15.1 Số đo ở 1 triệu

| Thao tác | 200k | **1M** | Vì sao |
| --- | ---: | ---: | --- |
| `ORDER BY code` trang 1 | 0,17ms | **0,16ms** | ✅ phẳng — `device_code_key` là unique index |
| `ORDER BY code` trang **50.000** | 74ms | **456ms** | ⚠️ `OFFSET` là **O(offset)**: phải đi qua 1 triệu mục index rồi vứt đi 999.980 |
| `count(*)` tổng | 30ms | **184ms** | ⚠️ chạy **mọi** lượt mở trang, song song với truy vấn dòng |
| **`ORDER BY name` trang 1** | — | **340ms** | 🔴 **không có index** → Parallel Seq Scan + top-N heapsort |
| **`ORDER BY name` trang 50.000** | — | **1.949ms** | 🔴 external merge, **tràn 228 MB ra đĩa** (3 worker × ~77 MB) |
| `ORDER BY status` trang 1 | — | 0,22ms | ✅ có `device_status_idx` |
| Tìm `ILIKE` 4 cột | 207ms | **951ms** | 🔴 và ×2 vì `rows` + `count` chạy song song |
| Lọc theo site + count | 10ms | 139ms | ✅ |
| Sắp hết hạn 30 ngày | 6.477 dòng | **32.255 dòng** | |
| **Đã quá hạn (tích luỹ)** | ~44.000 | **213.333 dòng** | 🔴 |

**Chỗ hỏng lớn nhất không phải cái ai cũng đoán.** `DEVICE_SORT_KEYS` cho phép sắp xếp theo
**sáu** cột — `code · name · serial · assignedTo · status · warrantyEnd` — nhưng chỉ **`code`**
và **`status`** có index dùng được. `serial` có index nhưng là `lower(serial)` *có điều kiện*
nên `ORDER BY serial` không dùng được; `warrantyEnd` có index *partial* `WHERE status <> 'retired'`
nên chỉ dùng được khi câu truy vấn mang đúng điều kiện ấy; `name` và `assignedTo` **không có gì**.

Nghĩa là: **người dùng bấm vào tiêu đề cột "Tên thiết bị" để sắp xếp là ép Postgres sắp xếp
1 triệu dòng — 340ms ở trang 1, 1,9 giây ở trang sâu, 228 MB ghi tạm ra đĩa.** Một cú bấm.

### 15.2 Ba bản sửa, đo trên chính 1 triệu hàng đó

| Bản sửa | Trước | Sau | Tỉ lệ |
| --- | ---: | ---: | ---: |
| **Index `(name, id)`** cho cột sắp xếp | 340ms | **0,083ms** | **~4.100×** |
| **Keyset** thay `OFFSET` ở trang sâu | 456ms | **0,099ms** | **~4.600×** |
| **`unaccent` + GIN `gin_trgm_ops`** | 951ms / **0 kết quả (SAI)** | 241ms / **83.333 kết quả (ĐÚNG)** | 4× + chữa đúng đắn |
| Nâng `work_mem` 4 MB → 256 MB | 1.992ms | **2.592ms** | **CHẬM HƠN 1,3×** |

Chi phí dung lượng: `device_name_idx` 61 MB · `device_search_trgm` 86 MB → bảng 432 MB thành
**573 MB**. Đổi 141 MB đĩa lấy bốn nghìn lần tốc độ.

> **Dòng cuối bảng là bài học đắt nhất của cả mục này.** Tôi kỳ vọng `work_mem` lớn sẽ cứu
> được lượt sort tràn đĩa. Ở 256 MB sort đúng là chạy trong RAM (`quicksort Memory: 244490kB`)
> — **nhưng tổng thời gian TĂNG từ 1,99s lên 2,59s.** Chi phí thật nằm ở việc đọc và sắp xếp
> 1 triệu hàng, không nằm ở chỗ ghi tạm. Chỉnh tham số mua được 0×; một index mua được 4.100×.
> **Đừng chỉnh Postgres để né việc đánh index.**

`random_page_cost` 4 → 1,1 (hợp SSD) không đổi kế hoạch nào trong các câu đã đo. Vẫn nên đổi
vì nó đúng với phần cứng, nhưng **đừng trông đợi nó sửa được gì ở đây**.

### 15.3 Về thiết kế phân trang anh hỏi (mặc định 20, chọn 30/50/100, số trang 1,2,3…n)

**Hiện trạng cần biết trước: `web/src/ui/pagination.tsx` KHÔNG có nút số trang nào.** Nó chỉ
có `‹` `›`, chữ "Trang 7/50000", và ô chọn số dòng. Ở 1 triệu hàng chia 20 dòng/trang =
**50.000 trang**, và cách duy nhất tới trang 7.431 là bấm `›` **7.430 lần**.

Ô chọn hiện là `PAGE_SIZES = [10, 20, 50, 100]` (mặc định 20 — đúng ý anh; chưa có 30).
`limit` được kiểm chặn theo đúng danh sách này nên `?limit=99999` không lọt — chỗ này làm tốt.

**Cách làm đúng — cửa sổ trang, KHÔNG bao giờ vẽ N nút:**

```
‹  1  …  4  5  [6]  7  8  …  50000  ›     ← luôn ≤ 9 nút, bất kể tổng bao nhiêu trang
```

Luật: luôn hiện trang đầu + trang cuối + (hiện tại ± 2), chèn `…` vào khoảng trống. Số nút là
**O(1)**, không phải O(số trang). Kèm một ô "tới trang ___" cho ai thật sự cần nhảy xa.

Ý "1, 2, 3, 10, 50, 100…" của anh là kiểu nhảy theo cấp số — dùng được, nhưng người dùng ít
gặp nên hay bấm nhầm; cửa sổ ± 2 là mẫu quen thuộc hơn. Nếu thích kiểu cấp số thì nên có **cả
hai**: cửa sổ cho vùng gần, vài mốc xa, rồi ô nhập số trang.

**Nhưng đây mới là lời khuyên thật:** ở 50.000 trang thì **số trang là UI sai**. Không ai muốn
tới trang 27.431 — người ta muốn *tìm được cái máy đó*. Ngân sách nên dồn vào **bộ lọc và ô tìm
đủ tốt để kết quả co xuống vài trang**, chứ không phải vào việc vẽ đường tới trang 27.431. Số
trang quá ~100 chỉ là trang trí.

**Và có một mâu thuẫn kỹ thuật phải chọn bên:**

| | Nhảy được tới trang bất kỳ | Thời gian trang sâu |
| --- | :---: | ---: |
| `OFFSET` (hiện tại) | ✅ | **456ms** ở trang 50.000 |
| Keyset (`WHERE code > :cuối`) | ❌ chỉ trước/sau | **0,099ms**, hằng số |

**Khuyến nghị lai — và đây là cách tôi sẽ làm:**

1. **`‹` `›` đi bằng keyset** — đó là 95% thao tác thật, và nó thành hằng số 0,1ms ở mọi độ sâu.
2. **Nhảy số trang giữ `OFFSET`** — hiếm dùng, 456ms một lần là chấp nhận được.
3. **Đếm tổng có trần.** `count(*)` 184ms mỗi lượt mở trang là thuế đắt nhất còn lại. Repo **đã
   có sẵn khuôn**: `audit-query.service.ts:123-148` đếm bằng
   `SELECT count(*) FROM (SELECT 1 … LIMIT 10001)` rồi hiện "10.000+". Dùng lại đúng khuôn đó
   cho `device` — trên 10.000 thì con số chính xác chẳng ai cần, mà nó đang tốn một lượt quét
   toàn bảng mỗi lần mở trang.

### 15.4 Danh sách việc cho 10-20 năm, xếp theo lợi/công

| # | Việc | Đo được | Khi nào |
| --- | --- | --- | --- |
| 1 | **Index mọi cột sắp xếp được** — `(name, id)`, `(assigned_to, id)`, `(serial, id)`, `(warranty_end, id)` không partial | 340ms → **0,083ms** | **Ngay.** Rẻ nhất, lợi nhất |
| 2 | **`unaccent` + GIN trgm** cho 5 bảng tra cứu | 951ms/sai → 241ms/đúng | **Ngay** — gộp với B-01 |
| 3 | **Trần cho `count(*)`** theo khuôn `COUNT_CAP` đã có | 184ms → ~1ms | Ngay, rẻ |
| 4 | **Phân trang máy chủ cho `/expiry`** + tách rổ quá hạn | 213.333 dòng đang đổ vào một bảng | **Gấp nhất** |
| 5 | **Cửa sổ số trang** + ô nhảy trang | 7.430 cú bấm → 1 | Khi làm UI |
| 6 | Keyset cho `‹` `›` | 456ms → 0,099ms | Khi phân trang đụng ~1M |
| 7 | **Vòng đời cho hồ sơ quá hạn** — chính sách lưu trữ/thanh lý hàng loạt | rổ chỉ tăng theo *thời gian* | Trước năm thứ 3 |
| 8 | **Phân vùng `audit_log`** theo `created_at` (mục 5.3) | 231k dòng/28 ngày ⇒ ~3 triệu/năm, **không có đường xoá** | Trước khi bảng chạm ~50 GB |
| 9 | Chỉnh Postgres: `shared_buffers` 128 MB → ~2 GB, `random_page_cost` → 1.1, `effective_io_concurrency` → 200 | **không sửa được gì đã đo** | Làm cho đúng, đừng kỳ vọng |

**Về thuật toán:** không cần gì lạ. Ba thứ trên — B-tree cho sắp xếp, GIN trigram cho tìm chuỗi
con, keyset cho phân trang — là đủ cho 10-20 năm ở quy mô này. Thứ thật sự không mở rộng được
không phải thuật toán, mà là **những màn không phân trang** và **những rổ dữ liệu không có
đường ra**.

### 15.5 Chuyển sang Ubuntu — sẽ nhanh hơn, nhưng không phải thứ anh cần

Docker Desktop trên Windows chạy container trong máy ảo WSL2; dữ liệu Postgres nằm trong volume
ext4 bên trong một file VHDX, đi qua thêm một tầng khối ảo hoá. Linux chạy thẳng bỏ được tầng
đó, quản lý bộ nhớ không bị trần WSL2, và không mất phần CPU cho Hyper-V. **Kỳ vọng hợp lý:
nhanh hơn ~20-40% ở phần chạm đĩa, ít hơn nhiều ở phần thuần CPU.**

Nhưng đối chiếu với đúng những con số ở trên:

| Chỗ chậm | Ubuntu giúp được | Bản sửa đúng |
| --- | --- | --- |
| `ORDER BY name` 1.949ms | có thể còn ~1,4s | index → **0,083ms** |
| Tìm kiếm 951ms | có thể còn ~700ms | trgm → **241ms**, và **sửa được cả kết quả sai** |
| `/expiry` 77 giây | **0** — đó là DOM của trình duyệt, không liên quan OS máy chủ | phân trang |

**Ubuntu là nhân đôi; index là nhân nghìn.** Cứ chuyển — nó đúng cho production và tôi ủng hộ —
nhưng đừng để nó đứng trước ba việc ở mục 15.4. Và nhớ: lần đo nào cũng phải đo LẠI sau khi
chuyển, vì `random_page_cost`/`effective_io_concurrency` hợp lý trên NVMe native khác hẳn trên
VHDX.

Một điều **không** đổi khi sang Ubuntu: 213.333 hồ sơ quá hạn vẫn là 213.333 dòng đổ vào một
bảng HTML.

### 15.6 Trạng thái DB sau lượt đo này

`device` đang giữ **1.000.001 hàng** demo. Mọi nguyên mẫu (`search_norm`, `device_search_trgm`,
`device_name_idx`, hàm `ims_norm`, extension `unaccent`) **đã gỡ hết** để DB dev không lệch khỏi
migration. `ops/unseed-demo.sql` xoá sạch dữ liệu demo (khớp cả mã 6 và 7 chữ số) — **chạy nó
trước lượt E2E kế tiếp.**

---

## 16. Lượt 1 — cổng (ĐÃ LÀM 20/09/2026)

> Trong commit `2a01e08` lượt này được gọi là **"đợt A"**. Xem ô chú giải ở đầu mục 8 để
> biết vì sao cái tên ấy bị bỏ.

Đợt đầu của kế hoạch ở §9. Mục tiêu không phải sửa nhiều lỗi mà là **làm cho lỗi không sống
sót qua cổng được nữa**.

### 16.1 Cổng đã bật

| Cổng | Trước | Sau |
| --- | --- | --- |
| `npm --prefix web run lint` | `eslint .` — **30 cảnh báo đi qua** | `eslint . --max-warnings=0` · **0** |
| `npm --prefix api run lint` | `eslint …` — 1 cảnh báo đi qua | `… --max-warnings=0` · **0** |
| `depcruise` | 1 vi phạm mức cảnh báo (`no-orphans`) | **no dependency violations found** |

**F-03 đóng.** Đây là cổng đã để F-01 sống sót: eslint in ra đúng dòng, đúng tên biến
(`missing dependencies: 'kindLabel' and 'nguong'`) suốt từ lúc bản vá ra đời, và không ai phải
đọc nó vì cảnh báo không chặn gì.

### 16.2 Lỗi thật sửa được nhờ dọn 30 cảnh báo

| # | Chỗ | Việc |
| --- | --- | --- |
| **F-01** *(BLOCKER)* | `expiry-screen.tsx:216` | Thêm `nguong` vào deps; bọc `kindLabel` bằng `useCallback` trước (hàm mới mỗi render thì thêm vào deps chỉ làm memo tính lại mỗi render — tức vô hiệu hoá chính nó) |
| **F-02** *(CAO)* | 5 trang chi tiết + bảng điều khiển | `data!` → `if (!x.data) return <Loading/>`. Mất mạng ⇒ `fetchStatus:'paused'` ⇒ `isLoading` false, `isError` false, `data` undefined — hai nhánh thoát đều trượt và trang **trắng** |
| L-6 | `isp-detail.tsx:207` | `PATHS.device(item.deviceId!)` **chạy thật** cả khi `deviceId` rỗng (JSX dựng `children` trước khi `DataItemIfSet` quyết `return null`) → `!` là lời khẳng định sai ở đúng nhánh nó khẳng định |
| L-4 | `command-palette.tsx:318` | Gỡ `eslint-disable` đã thừa — một disable thừa sẽ nuốt im một cảnh báo THẬT về sau |
| — | `accounts-screen.tsx:164` | `refresh` bọc `useCallback` (nó nằm trong deps của `columns`) |
| — | `subnet-detail.tsx:133` | `all` vào `useMemo` |
| — | `main.tsx:9` · `warranty-timeline` ×3 · `time-picker` ×2 · `license-assignments-panel` · `catalog-screen` | Bỏ 8 dấu `!` còn lại bằng cửa canh thật, không bằng `eslint-disable` |
| — | `web/src/lib/fetch-json.{ts,test.ts}` | **Xoá** — 0 nơi gọi trong sản phẩm, đã bị `lib/api-client.ts` thay. Đây là thứ `no-orphans` chỉ ra |

`!` trong **bài kiểm** được nới qua `eslint.config.mjs` (11 chỗ): ở đó `rows[0]!` là một lời
khẳng định mà nếu sai thì **bài kiểm đỏ** — đúng thứ ta muốn. Không hạ rule toàn cục xuống
`warn`, vì làm thế là 11 chỗ trong bài kiểm che mất mọi `!` MỚI lọt vào `features/`.

### 16.3 Bài kiểm đầu tiên cho `features/expiry/` — và nó suýt xanh vì lý do sai

`web/src/features/expiry/expiry-thresholds-live.test.tsx`. Cả thư mục trước đó **không có một
file test nào**; đó là nửa còn lại của lý do F-01 sống sót.

Bản ĐẦU của bài này **xanh cả khi gieo lại đúng lỗi cũ**. Nguyên nhân: `kindLabel` là
`useCallback([kinds.data])`, nên lúc `kinds` về nó đổi identity và memo tính lại — **vô tình**
nhặt được `nguong` mới. Bài xanh nhờ một dep khác cứu, không nhờ bản vá.

Cảnh hỏng THẬT là: người dùng đang ở Bảng điều khiển (đã nạp `['expiry','kinds']`) rồi bấm
sang `/expiry` — lúc đó `kinds.data` có sẵn từ render 1 và không bao giờ đổi, nên `nguong` là
dep duy nhất còn có thể làm memo tính lại. Bản sửa: gieo sẵn cache ấy bằng
`qc.setQueryData(['expiry','kinds'], …)`.

Sau khi sửa, gieo đột biến (bỏ `nguong` khỏi deps) → bài **ĐỎ** đúng chữ ký của lỗi:

```
AssertionError: expected 'badge warn' to contain 'danger'
```

> Đây là lần thứ ba trong cả lượt rà soát này một phép đo/bài kiểm suýt nói dối theo hướng
> *dễ chịu* (xem §13.4 và §14.7). Quy ước rút ra: **một bài kiểm chưa gieo đột biến thì chưa
> phải bài kiểm** — và với bài canh `useMemo`, đột biến phải là chính cái dep bị bỏ.

### 16.4 Kiểm chứng

| Cổng | Kết quả |
| --- | --- |
| `npm --prefix web run lint` (`--max-warnings=0` + depcruise) | ✅ 0 / no violations |
| `npm --prefix api run lint` (`--max-warnings=0`) | ✅ 0 |
| `npm --prefix web run build` · `npm --prefix api run build` | ✅ |
| Jest | ✅ **893/893** |
| Vitest | ✅ **44 file / 362 bài** (−1 file `fetch-json`, +1 file `expiry`) |
| `npm --prefix e2e run typecheck` | ✅ |
| Đột biến trên F-01 | ✅ đỏ, rồi trả lại |
| `npm --prefix api run test:db` (tầng chạm DB thật) | ✅ **14 suite / 74 bài** |
| **Playwright — TRỌN BỘ, desktop + mobile-390** | ✅ **440/440** (34,6 phút) |
| Đột biến trên A-09 (xoá câu `FOR UPDATE` thật ở `subnet.service.ts:257`) | ✅ bài kiểm **ĐỎ** — `expect(lockAt).toBeGreaterThan(-1)` nhận `-1`; trước bản vá cùng đột biến ấy để bài **XANH** |

**DoD gạch 7 ĐẠT.** Stack dựng lại trước khi chạy và đã xác minh hiện vật (`curl / | grep
static/index-` = `index-BQXeBY_k.js`, khớp `web/dist/`), nên 440 bài chạy trên đúng mã đã sửa
chứ không trên ảnh cũ. Dữ liệu demo dọn sạch trước lượt chạy — DB về đúng trạng thái gốc
(1 thiết bị, 2 phần mềm, 1 site, 1 dải, 1 IP).

`login.rate_limit_per_ip` đã trả về **20** sau lượt chạy (bộ E2E nâng lên 500 và teardown
không có bản cất để trả lại — xem B-15).

### 16.5 A-09 — lưới rách đã vá, và đo được nó rách thật

`api/test/subnet-cidr-race.spec.ts` canh hợp đồng khoá của `SubnetService.update()` bằng cách
đọc mã nguồn rồi `indexOf('FOR UPDATE')`. Trong `subnet.service.ts`, chuỗi ấy xuất hiện **lần
đầu ở dòng 253 — bên trong block comment** giải thích vì sao cần khoá; câu SQL thật ở **dòng
257**. Docblock của chính file test (`:33-35`) thừa nhận ba bài đua phía trên chạy trên SQL
hằng số khai trong test, và chỉ sang bài này làm vế bù — nên khi bài này rách thì **cả file**
là lưới rách.

Đo bằng cách xoá đúng dòng 257 và giữ nguyên chú thích:

| | lát THÔ (bài cũ) | lát SẠCH (bài mới) |
| --- | :---: | :---: |
| Mã gốc | có `FOR UPDATE` | có `FOR UPDATE` |
| **Xoá câu SQL thật** | **vẫn có** → bài **XANH SAI** | **không còn** → bài **ĐỎ** |

Bản vá dùng `stripComments()` mới ở `api/src/test/source-text.ts`. Và nó là **một** bản dùng
chung chứ không phải bản thứ năm: cùng cặp `.replace()` ấy đang được chép **4 lần trong riêng
`vault-surface.spec.ts`** — bốn bản đó đã gom về helper trong cùng lượt sửa (Jest vẫn 893/893).
Đặt ở `src/test/` theo tiền lệ `web/src/test/quet-nguon.ts`; `jest.config.js` không nhặt nó vì
tên không mang `.spec.`, còn `test/jest-db.cjs` import bằng đường dẫn tương đối.

> **Đánh số nhảy một bậc (không có 16.6).** Rà soát chéo 21/09 bắt được chỗ này và đặt đúng
> câu hỏi: một mục biến mất khỏi sổ nghiệm thu là dấu hiệu nội dung bị cắt lúc soạn. Đã tra
> `git log -S` trên cả bốn commit chạm vào tệp này — **`### 16.6` chưa từng tồn tại**, nên
> không có gì mất. Giữ nguyên số thay vì đánh lại: mục 16.7 và 16.8 đang được trích dẫn ở
> nhiều chỗ, đổi số để bảng mục lục đẹp hơn thì đổi lấy một loạt tham chiếu trỏ hụt.

### 16.7 A-10 · T-03 · AD-16 — ĐÃ LÀM 20/09/2026

**A-10 — hai hàng rào bảo mật thôi là chuyện truyền miệng.**

| File mới | Bài | Nội dung |
| --- | ---: | --- |
| `auth/roles.guard.spec.ts` | 8 | Nhánh **mặc-định-đóng** (`ROLES_NOT_DECLARED`), `@Roles()` rỗng cũng chặn, mã từ chối vì SAI VAI khác mã vì QUÊN KHAI, `@Public()` đi thẳng, không có user vẫn chặn, vai lạ không lọt |
| `auth/csrf.guard.spec.ts` | 20 | GET/HEAD/OPTIONS đi thẳng · 4 method ghi bị kiểm · Origin lạ chặn TRƯỚC cả token (kể cả route công khai) · chuẩn hoá hoa-thường và dấu `/` · **hai nhánh bỏ qua im lặng** (`!expected`, `!origin`) khoá đúng hình dạng hiện tại · 5 biến thể token sai · phiên không tìm thấy · `CSRF_NO_SESSION` |
| `auth/roles-surface.spec.ts` | 5 | **Cổng tĩnh**: mọi route handler phải được phủ bởi `@Roles(...)` cấp route hoặc cấp lớp, hoặc `@Public()`. `RolesGuard` phải là `APP_GUARD`. Kèm một bài **tự kiểm bộ quét** |

Đột biến: gỡ nhánh mặc-định-đóng của `RolesGuard` + bỏ `assertOrigin` của `CsrfGuard` ⇒ **7 bài
đỏ**. Gỡ `@Roles` khỏi `GET /vault/secrets` ⇒ cổng tĩnh **đỏ**.

**Bộ quét tự bắt được hai lỗi của chính nó trong lúc viết** — đáng ghi hơn cả kết quả:

1. `classDecoratorsOf` (kế thừa từ `step-up-surface.spec.ts`) chỉ đi **LÊN** từ `@Controller(...)`.
   Nó tình cờ đúng suốt vì mọi controller đặt `@NoStepUp()` ở trên; `audit.controller.ts` đặt
   `@Roles` ở dòng **ngay dưới**, nên bộ quét đọc hụt và báo hai route KHÔNG thiếu là thiếu.
2. `routesOf` bản đầu chạy `stripComments(src)` **rồi mới tách dòng** — `.replace()` nuốt luôn
   xuống dòng của block comment, nên `line` lệch so với file thật và chỗ docblock biến mất để
   lại dòng trống, mà dòng trống lại là ranh giới ⇒ khối decorator bị cắt cụt và **13 route
   KHÔNG thiếu** bị báo là thiếu.

> Dương-tính-giả ở một cổng bảo mật là thứ dạy người ta tắt cổng. Cả hai lỗi chỉ lộ ra vì bài
> tự-kiểm-bộ-quét chạy cùng lúc — nếu không, tôi đã "sửa" bằng cách nới luật.

Hai helper (`allControllers`, `classDecoratorsOf`) chuyển vào `src/test/source-text.ts` và
`step-up-surface.spec.ts` refactor để dùng bản chung — không tạo bản sao thứ hai (AD-15).

**T-03 — cửa canh khoá i18n chết thôi che 118 khoá.**

Luật cứu-theo-tiền-tố có lỗ: `` t(`nat.${ipCheck.reason}`) `` sinh tiền tố `'nat.'` và
`k.startsWith(t)` vì thế cứu **trọn 60 khoá `nat.*`**; `` t(`serviceAccounts.${done}`) `` cứu
tiếp **58 khoá**. Mỗi template thật ra chỉ dùng HAI khoá.

Sửa: tiền tố kết thúc bằng `.` không được tự động cứu ai; khoá mà template rộng thật sự dựng
ra thì khai tay ở `KHOA_DUNG_DONG` (4 dòng, đọc được). Hậu quả ngay lập tức — cổng bắt được
**7 khoá chết**: 6 cái là rác thật (`nat.deviceType`, `nat.deviceTypeHint`, `nat.allTypes`,
`nat.serviceSearch`, `nat.servicePick`, `serviceAccounts.back`) đã **xoá khỏi `vi.ts`**; cái
thứ bảy — `nat.serviceEmpty` — là một **câu ĐÚNG chưa được đấu dây**, giữ lại trong
`DUOC_PHEP_KHONG_DUNG` kèm lý do và đường đi tiếp (cần prop `empty` cho `ui/combobox.tsx`).

Đột biến: gieo `nat.zzzKhoaChetGieoVao` vào `vi.ts` ⇒ **đỏ**. Trước bản vá, cùng khoá ấy được
tiền tố `'nat.'` cứu và cổng **xanh**.

**AD-16 — luật lint chặn định danh tiếng Việt mới.**

Cắm vào **cả ba** cấu hình (`web` · `api` · `e2e`) — một luật, ba nơi gọi, cùng một phương ngữ
ESLint đúng như quyết định 07/09. Ở web nó còn được bật **riêng cho file test**
(`'no-restricted-syntax': ['error', NO_VIETNAMESE_IDENT]` thay vì `'off'` trọn gói): bài kiểm
cũng là mã.

Bắt được ngay **`bỏQuen`** ở `e2e/tests/reset-domains-rollcall.spec.ts` — đúng định danh có
dấu duy nhất trong repo mà mục 3.1 đã chỉ ra. Đổi thành `ignoreKnown`.

Hai chỗ api bị bắt là **đúng ngoại lệ đã ghi** — bảng ánh xạ nhãn nhập-Excel (`hỏng:`, `tủ:`).
Sửa bằng cách **đặt khoá trong nháy** (`'hỏng':`) chứ không nới luật: chúng là DỮ LIỆU, mọi
khoá anh em có dấu cách đã được nháy sẵn, và cách này không để lại một ngoại lệ cấu hình cho
người sau hiểu nhầm là được phép đặt tên tiếng Việt ở đó.

**Bài canh chính cái cổng** (`web/src/lint-rules.test.ts`, +5 bài): 4 ca khẳng định (biến ·
hàm · tham số · thuộc tính có dấu) và **1 ca phủ định** — chuỗi i18n, chú thích tiếng Việt và
khoá đã-đặt-trong-nháy **không được** báo lỗi. Vế phủ định quan trọng ngang vế khẳng định: một
luật bắt nhầm cả đường đi đúng sẽ bị tắt trong vòng một tuần.

**Lớp 2 (tiếng Việt KHÔNG dấu) — CHỐT THỨ TỰ: làm SAU khi đổi tên xong (chủ dự án duyệt 20/09).**

> Không xây lớp 2 trước. Nó cần một **danh sách miễn trừ** cho 175 tên còn lại trong mã kiểm
> thử — mà chính đợt G sẽ xoá gần hết. Xây bây giờ là viết một danh sách 175 dòng để rồi vứt.
> Làm ngược lại thì sạch: đợt 3 (tên tệp) → đợt 4 (mã kiểm thử) → đợt 5 (`di-khap-giao-dien`),
> xong thì danh sách miễn trừ **RỖNG**, và luật chỉ cần nói "không được có tên tiếng Việt,
> chấm hết" — không ngoại lệ để ai cãi.
>
> **Rủi ro trong lúc chờ:** ai đó thêm tên tiếng Việt không dấu mới. Đánh giá THẤP — đúng giai
> đoạn đó cả đội đang chủ động xoá chúng, và lớp 1 vẫn chặn mọi tên CÓ DẤU.
>
> Nếu rủi ro ấy thành thật (ví dụ đợt G bị hoãn dài), bản rẻ hơn (~1 giờ) là một **bộ đếm**:
> "hôm nay có 175 tên tiếng Việt, con số này chỉ được phép GIẢM". Không cần từ điển hoàn hảo,
> chỉ cần đếm được — và nó chặn đúng thứ cần chặn là THÊM MỚI.

Lý do kỹ thuật ban đầu vẫn giữ: Nó cần từ điển ~900 âm tiết cộng một phép tính
tỉ lệ, và một allowlist của 222 tên hiện có — mà chính đợt G sẽ làm danh sách ấy co lại. Dựng
allowlist bây giờ là dựng một thứ sẽ phải viết lại. Làm cùng đợt 3 của mục 3.2.

### 16.8 Kiểm chứng sau trọn đợt A

| Cổng | Trước đợt A | Sau |
| --- | ---: | ---: |
| web lint (`--max-warnings=0` + depcruise) | 30 cảnh báo lọt · 1 vi phạm | **0 · no violations** |
| api lint (`--max-warnings=0`) | 1 cảnh báo lọt | **0** |
| e2e lint | 0 | **0** |
| Jest | 52 suite / **893** bài | 55 suite / **926** bài |
| Vitest | 44 file / 362 bài | 44 file / **367** bài |
| `test:db` | 14 / 74 | 14 / **74** |
| web build · api build · e2e typecheck | ✅ | ✅ |

**Năm lượt gieo đột biến, cả năm đều ĐỎ đúng chỗ**: F-01 (deps) · A-09 (câu `FOR UPDATE`) ·
A-10 ×2 (mặc-định-đóng của `RolesGuard`, `assertOrigin` của `CsrfGuard`, và `@Roles` của một
route) · T-03 (khoá chết gieo vào `vi.ts`).


---

## 17. Lượt 2 — ba lỗ, ba cửa (ĐÃ LÀM 20/09/2026)

> Commit `ca18bc9` · `c2c8fdb` · `c64d892`, trong đó gọi là **"đợt B"**.

Ba mục còn lại của hai ô "chặn phát hành" và "CAO": **A-02** (gắn yếu tố thứ hai không cần
xác thực lại) · **A-03** (xoá ô ngày đi vòng qua luật) · **D-01** (app chạy bằng superuser).

Cả ba đều được chứng minh bằng một bài kiểm **ĐỎ TRƯỚC**, chạy trên stack thật, rồi mới vá.

### 17.1 A-02 — cái cookie tự gắn chìa khoá thứ hai cho mình

**Đo được trước khi vá.** Tạo một tài khoản `totpLoginRequired: false` (chưa cài 2 lớp), đăng
nhập bằng API, rồi gửi `POST /auth/totp/enroll` với **body rỗng**:

```
Expected: 401
Received: 200        ← và kèm secret base32 nguyên văn
```

Từ đó đi tiếp là chuyện số học: sinh mã 6 số từ secret → `step-up` → `reveal`. Đúng bốn bước
mà docblock của `step-up.guard.ts` tự viết ra hồi 10/09 khi giải thích vì sao step-up phải
mặc-định-đóng. Ba bước kia đã bịt; bước `totp/enroll` là bước còn lại.

**Hàng rào.** `POST /auth/totp/enroll` đòi mật khẩu hiện tại — mẫu "sudo mode". Cửa này không
phải cửa đọc: nó **trả ra** secret, tức nó quyết định ai giữ chìa khoá thứ hai của tài khoản
về sau.

**Và một hàng rào bị lượt chạy E2E bác bỏ — đáng ghi hơn cả hàng rào được giữ.** Bản đầu kèm
trần **10 lượt/phút theo USER**, chép từ `step-up`. Lượt chạy đầy đủ cho **mười ba bài đỏ liên
tiếp** ở `catalog.spec.ts`, tất cả cùng một chỗ: `firstLogin` chờ mã QR mãi không thấy. Lý do
hiển nhiên khi đã nhìn thấy nó — cửa này KHÔNG chỉ là cửa nhận mật khẩu, nó còn là **bước bắt
buộc của mọi lần đăng nhập lần đầu**, nên trần theo phút chặn đường ĐÚNG trước khi chặn được
đường sai.

Nó còn là hàng rào **sai loại**: trần theo phút cho kẻ tấn công thử lại mãi, chỉ chậm hơn —
10 lượt/phút vẫn là mười bốn nghìn lần đoán mỗi ngày. Thay bằng đúng cơ chế mà cửa két đã
dùng: sai đủ `secret.stepup_max_failures` lần thì **THU HỒI PHIÊN**, dùng chung bộ đếm với
step-up (hai cửa hỏi cùng một câu, nên năm lần sai xen kẽ hai cửa cũng phải chết y như năm
lần sai ở một cửa). Cookie trộm được **chết sau năm lần**, và muốn cookie mới thì phải có
đúng thứ nó đang đi đoán. Thu hồi PHIÊN chứ không khoá TÀI KHOẢN — khoá tài khoản thì chính
kẻ tấn công lại khoá được người dùng thật ra ngoài.

**Ngoại lệ, và vì sao nó phải có hạn.** Luồng đăng nhập bắt buộc cài 2 lớp đưa người dùng
thẳng từ ô mật khẩu sang màn quét QR. Hỏi lại ở đó là hỏi lại thứ vừa gõ xong, và phiên
`totp_pending` chưa mở được gì ngoài ba route của chính luồng đăng nhập. Nên ngoại lệ ấy tồn
tại — nhưng tính theo **tuổi phiên**, hết sau `totp.enroll_reauth_minutes` (0047, mặc định 15):
một phiên chờ bị bỏ quên trên máy bỏ ngỏ không được là cửa mở tới 12 giờ.

Và đo từ `created_at`, **không** từ `last_seen_at`. `last_seen_at` bị đẩy tới trước ở mỗi
request, nên đo theo nó là để chính kẻ đang giữ cookie tự gia hạn cửa cho mình — hàng rào sẽ
không bao giờ đóng với đúng người nó sinh ra để chặn. Bài kiểm khoá lại chuyện đó bằng cách
làm cũ `created_at` rồi bắn lại cùng cái cookie.

**Chặn mà không kêu vẫn là nửa hàng rào.** Người duy nhất biết chuyện đang xảy ra là người
đi đọc nhật ký — tức là không ai. `SecurityProbeService` (0046) đã có sẵn bộ đếm và đường gửi
thư, và chú thích của chính nó mời: *"thêm loại mới thì thêm vào đây, đừng đếm ở nơi gọi"*.
Cửa mới đăng ký vào `PROBE_ACTIONS`, đếm CHUNG với lượt gõ sai mã ở cửa két — tách hai bộ đếm
thì kẻ khôn ngoan chỉ cần xen kẽ hai kiểu là không chạm ngưỡng nào cả.

**Client không đoán lại luật.** `totp-enroll.tsx` cứ gọi, và chỉ dựng ô mật khẩu khi server
trả `REAUTH_REQUIRED`. "Ai được miễn" vì thế sống đúng một chỗ — nơi biết tuổi phiên và cờ
`totp_pending`. Đoán lại ở client là bản sao thứ hai, và bản sao sẽ lệch đúng vào hôm luật đổi.

| Bài | Canh gì |
| --- | --- |
| `totp-enroll-reauth.spec.ts` ×4 | cookie trần bị chặn (và **không rò secret**) · đoán sai mật khẩu cũng không rò · năm lần đoán ⇒ thư cảnh báo đi thật **và cookie chết hẳn** (`/auth/me` sau đó là 401) · phiên chờ quá hạn hết miễn · luồng cài lần đầu KHÔNG bị hỏi mật khẩu |
| `totp-enroll-reauth.test.tsx` ×3 (Vitest) | màn hình dựng được ô mật khẩu khi server đòi — và **không ai bị đá về đăng nhập** |
| `session-policy.spec.ts` +6 | bảng dữ liệu cho `canEnrollWithoutPassword`, gồm biên đóng đúng 15 phút và hàng "phiên đã đăng nhập đủ, vừa tạo xong → vẫn phải gõ" |

**Và một lỗ thứ hai, do chính bản vá A-02 sinh ra.** `apiFetch` coi MỌI 401 là "phiên chết"
trừ một danh sách loại trừ, và loại trừ là cố ý — quên khai một mã mới thì người dùng bị đưa
về màn đăng nhập, phiền nhưng an toàn và **tự thoát được**.

Chỉ có điều `REAUTH_REQUIRED` không tự thoát được: phiên vẫn sống, nên đăng nhập lại đưa người
dùng về đúng màn vừa đá họ ra, màn đó lại gọi `enroll`, lại 401, lại bị đá. Một vòng kín,
không lời giải thích. Bản vá phía API xanh hết mọi cổng và vẫn để lại cái vòng đó — vì **không
bài E2E nào đi qua đường "phiên đã đăng nhập thường đi cài 2 lớp"**: E2E luôn cài trong luồng
đăng nhập bắt buộc, tức đường ĐƯỢC MIỄN.

Ba bài Vitest mới (`totp-enroll-reauth.test.tsx`) canh đúng đường đó. Và bài đầu tiên của
chúng **cũng sai** ở bản đầu: nó chỉ hỏi "ô mật khẩu có hiện không", nên đột biến (bỏ
`'REAUTH_REQUIRED'` khỏi danh sách) **sống sót** — trong jsdom, `window.location.href = ...`
không đi đâu cả, không điều hướng, không ném, chỉ ghi một dòng "Not implemented". `apiFetch`
vẫn ném như thường và ô mật khẩu vẫn hiện. Bài xanh, người dùng thật thì đang ở màn đăng nhập.

Sửa bằng cách thay `location` bằng một vật có setter đếm được và khẳng định thẳng: `href`
KHÔNG được đổi. Đột biến khi đó đỏ đúng chỗ — `expected '/login' to be null`.

> Đây là lần thứ ba trong hai đợt rà soát mà **bài kiểm suýt nói dối theo hướng dễ chịu**, và
> cả ba lần cái cứu nó là một phép gieo đột biến chạy ngay sau khi viết bài. Một bài kiểm chưa
> từng đỏ thì chưa biết nó canh cái gì.

**Điều bản vá này KHÔNG làm, nói thẳng:** chuỗi trong docblock của `step-up.guard.ts` bắt đầu
bằng "SA tạo một tài khoản mới rồi lấy mật khẩu tạm". Kẻ đi đường đó **có** mật khẩu, nên hỏi
mật khẩu không chặn được nó. Đường ấy đã bịt từ 10/09 bằng việc `/accounts/*` đòi step-up —
A-02 bịt đường còn lại: cookie của một người chưa từng cài 2 lớp.

### 17.2 A-03 — xoá một ô ngày không giống bỏ trống nó

**Đo được trước khi vá.** Một chứng chỉ SSL có hạn `2027-01-31`, gửi `PATCH {"endDate":""}`:

```
Expected: 400
Received: 200        ← và end_date trong bảng đã thành NULL
```

`dateOnly("")` trả `null` = "người dùng đã xoá ô này". Nhưng `(values.endDate ?? current?.endDate
?? null)` coi `null` y hệt `undefined` = "không đụng tới ô này", nên `validateSoftware` soi
trên ngày **CŨ**, `requiresEndDate` không nổ, và câu ghi vẫn ghi `NULL`. Vì `findExpiringBetween`
lọc `end_date IS NOT NULL`, hồ sơ **biến khỏi mọi lời nhắc gia hạn, vĩnh viễn, không một dòng
lỗi.** Không lưới DB.

Lỗi này sai **theo cả hai chiều**, và chiều thứ hai chỉ lộ ra khi viết bài kiểm: đường truyền
ISP xoá ngày bắt đầu rồi đặt hạn sớm hơn ngày bắt đầu CŨ thì bị **từ chối** — bởi một giá trị
vừa bị xoá. Đúng cái bẫy "hàng rào tự nhốt người dùng vào trong" mà chú thích
`assertDeviceWithin` đã mô tả cho liên kết thiết bị hồi 08/09, lặp lại nguyên hình ở cặp ngày.

**Chỗ thứ ba mà rà soát 19/09 bỏ sót.** Quét `?? current?.` toàn `api/src` ra **ba** file, không
phải hai: `devices.service.ts:442-455` ghép cặp ngày bảo hành và **bốn** tham chiếu danh mục
bằng đúng phép ghép sai ấy. Hậu quả cụ thể: một thiết bị trỏ vào site đã bị gỡ khỏi danh mục
thì **không xoá được liên kết đó nữa** — gửi `siteId: ""` lên, luật đi kiểm site CŨ, và site
cũ không còn tồn tại.

**Bản vá.** Phép ghép chuyển thành một tài sản dùng chung, `common/merge-effective.ts`, hỏi
đúng câu cần hỏi: `field in values` — "yêu cầu này có nói gì về ô đó không?". Ba service HTTP
dùng nó, và `device-import.ts` — nơi idiom này ra đời từ 08/09 và làm ĐÚNG suốt — bỏ bản lambda
riêng để dùng bản chung (AD-15: một bản đúng nằm riêng trong một file thì bản thứ hai sẽ được
viết lại từ đầu, và viết sai).

> Lại đúng hình dạng của A-01: **cửa Excel được canh, cửa HTTP bỏ ngỏ.** Ba trên bảy lỗi CAO
> của rà soát này có cùng hình dạng đó. Nó không phải trùng hợp — đường Excel được viết sau,
> bởi người vừa đọc luật, nên nó nhớ; đường HTTP viết trước, và không ai quay lại.

| Bài | Canh gì |
| --- | --- |
| `clear-date-guard.spec.ts` ×3 | SSL không xoá được hạn **và hạn cũ còn nguyên sau lượt bị từ chối** · hợp đồng bảo trì VẪN xoá được (vế phủ định — luật mới không chặn nhầm đường đúng) · ISP xoá ngày bắt đầu rồi rút hạn về sớm hơn thì lưu được |
| `merge-effective.spec.ts` ×6 | bảng ba trạng thái, và mỗi hàng **viết lại nguyên văn bản `??` cũ** để bảng là bằng chứng chứ không phải lời kể — đúng một hàng lệch, và đó là hàng sinh ra A-03 |

### 17.3 D-01 — sổ chỉ-thêm chỉ chỉ-thêm với những người tử tế

**Đo được trước khi vá.** `SELECT rolsuper FROM pg_roles WHERE rolname='ims'` cho `t`. Ứng dụng
kết nối bằng chính role đó, và role đó vừa là superuser vừa là **chủ sở hữu** mọi bảng. Nên:

- câu `REVOKE UPDATE, DELETE, TRUNCATE ON audit_log` ở `0005` là **trang trí** — superuser bỏ
  qua toàn bộ ACL. Chú thích của chính migration ấy ghi "role `ims_app` do docker entrypoint
  tạo"; role đó **chưa bao giờ tồn tại**;
- AD-9 ("REVOKE UPDATE/DELETE ở tầng DB role") vì thế **không đúng với thực tế đang chạy**;
- trigger là lưới thật, nhưng `0039` đã tự khai lỗ còn lại: chủ sở hữu làm được
  `ALTER TABLE audit_log DISABLE TRIGGER ALL` rồi `DELETE` sạch dấu vết.

**Bản vá — hai role, hai kết nối.**

| Role | Dùng lúc nào | Làm được gì |
| --- | --- | --- |
| `ims` (chủ sở hữu) | Mấy giây đầu mỗi lần boot: tạo role, chạy migration, rồi **đóng pool hẳn** | Tất cả |
| `ims_app` | Cả đời tiến trình | DML bảng nghiệp vụ; `audit_log` chỉ `SELECT` + `INSERT` |

`0048_app_role_split.sql` phát quyền, kèm `ALTER DEFAULT PRIVILEGES` — không có nó thì bảng
của migration 0049 ra đời **không** có quyền cho `ims_app`, và lỗi hiện ra ở production giữa
một nghiệp vụ, dưới dạng một câu "permission denied". Mật khẩu role do `main.ts` đặt lúc boot
từ `APP_DB_PASSWORD`, không nằm trong file migration đi vào git.

**Và một cổng cho chính bước triển khai.** Nửa thứ hai của D-01 nằm trong `.env` của từng nơi
cài, tức ngoài git của ai cả: migration chạy xong mà `.env` chưa đổi thì mọi thứ vẫn xanh, vẫn
chạy, và NFR-03 vẫn sai y như trước — đúng kiểu "sẽ không tự rơi vào epic nào" mà mục 5.1 đã
nói. Nên `main.ts` tự hỏi mỗi lần khởi động, bằng chính kết nối nó sẽ dùng cả đời: *role này
có phải superuser không, và nó có sở hữu `audit_log` không*. Ở production thì **ném**; ngoài
production thì kêu to.

Hai câu hỏi chứ không phải một: vế thứ hai ít hiển nhiên hơn và nguy hiểm ngang — một
`ims_app` lỡ được cấp quyền sở hữu bảng thì "đã tách role" trở thành câu nói đúng về giấy tờ
mà sai về thực tế.

**Bài kiểm chốt MÃ LỖI, không chốt "có ném".** `UPDATE audit_log` bị chặn bởi HAI lớp — ACL và
trigger. Chỉ khẳng định "câu lệnh ném lỗi" thì bài xanh cả khi ACL không có tác dụng gì, vì
trigger một mình cũng làm nó xanh. Mà trigger là lớp chủ sở hữu **tháo được**; ACL mới là lớp
`ims_app` không chạm tới. Nên bài chốt `42501` (`insufficient_privilege`), khác hẳn `P0001` mà
`RAISE EXCEPTION` trong trigger sinh ra — đó là khác biệt giữa "có hàng rào" và "có ĐÚNG hàng
rào mà AD-9 hứa".

| Bài | Canh gì |
| --- | --- |
| `app-role-privileges.spec.ts` ×6 (tầng DB thật) | `INSERT` được · `UPDATE`/`DELETE`/`TRUNCATE` chặn ở **42501** · `DISABLE TRIGGER` và `DROP TRIGGER` chặn ở **42501** · DML bảng nghiệp vụ bình thường · **bảng tạo SAU 0048 vẫn có quyền** · cổng khởi động cho chủ sở hữu TRƯỢT và cho app ĐẬU |
| `app-role.spec.ts` ×4 | bảng dữ liệu cho phép phán xét, gồm hàng "không superuser nhưng sở hữu `audit_log`", và một bài chốt câu lỗi có nói ra chỗ phải sửa |

**Bước triển khai — phải làm tay đúng một lần mỗi nơi cài.** Thêm hai dòng vào `.env`
(`APP_DB_USER`, `APP_DB_PASSWORD`; `.env.example` đã có mẫu). Thiếu thì `docker compose up`
dừng ngay với câu "bắt buộc — mật khẩu role ứng dụng", chứ không chạy nửa vời.

### 17.4 Và một hệ quả mà chỉ lượt chạy đầy đủ mới lôi ra

Lượt E2E đầu tiên sau khi tách role **đỏ gần như toàn bộ**, tất cả cùng một câu:

```
Reset E2E thất bại: reset vùng "catalog" thất bại: must be owner of table catalog_history
```

`api/scripts/reset-e2e.mjs` — công cụ dọn dữ liệu giữa các bài — chạy
`ALTER TABLE ... DISABLE TRIGGER` trên **mười mấy** bảng lịch sử để xoá được hàng do bài kiểm
sinh ra. Câu lệnh ấy đòi quyền sở hữu, và tới hôm qua nó chạy được **chỉ vì** ứng dụng kết nối
bằng một role vừa superuser vừa chủ sở hữu.

Nói cách khác: script dọn rác của bộ test là **bằng chứng sống** cho chính lỗ mà D-01 mô tả.
Nó đã dùng quyền tháo-trigger suốt nhiều tháng, và không ai để ý, vì quyền ấy có sẵn.

Sửa: script lấy đường riêng (`MIGRATION_DATABASE_URL`). Nó KHÔNG phải một phần của ứng dụng —
cố ý không nằm trong ảnh production, chỉ được mount bởi file override E2E, và còn đòi
`ALLOW_E2E_RESET=1`. Quét lại toàn repo: **không còn chỗ nào khác** cần quyền sở hữu.

> Đây là loại phát hiện mà không bài kiểm đơn lẻ nào tìm ra được. Sáu bài DB-tier của D-01 đều
> xanh, ba bài E2E mới đều xanh, và lỗi vẫn nằm đó — ở một đoạn hạ tầng mà không ai coi là
> "code". Chỉ lượt chạy 443 bài mới hỏi được câu "cả hệ thống có còn sống dưới role hẹp không".

### 17.5 Ba mục dọn nốt — 21/09/2026

Ba thứ tôi tự khai là còn sót khi tổng kết đợt B, làm nốt trong một lượt.

**(1) Một phát hiện tôi định ghi và đã quên.** Trong lúc vá A-03 tôi thấy `validateRefs` chỉ
kiểm cặp tủ↔site **khi `refs.siteId` khác rỗng** — nên gửi `{"siteId":""}` lên một thiết bị
đang gắn tủ thì phép kiểm bị bỏ qua trọn vẹn, và hàng ra có `cabinet_id` mà không có
`site_id`. Máy nằm trong một cái tủ thuộc về hư không: không lọc ra được bằng site nào.
Đường Excel chặn đúng chuyện này từ lâu. Nay là **A-11** ở mục 7.2 và một gạch ở 8.3.

Vẫn **không sửa** trong đợt này, và lý do ghi thẳng vào mục: A-03 chỉ đổi phép GHÉP, còn lỗ
này cần một LUẬT MỚI trong `validateRefs` — mà luật mới thì có thể chặn dữ liệu cũ đang chạy.
Phải đếm `cabinet_id IS NOT NULL AND site_id IS NULL` trên DB thật trước đã.

**(2) Một chú thích nay nói sai về code.** Docblock của `step-up.guard.ts` mô tả chuỗi 6 bước
mà kẻ tấn công đi được, và bước 4 chính là lỗ A-02 vừa bịt. Để nguyên thì người đọc sau này
tưởng lỗ còn đó. Đã thêm một khối nói rõ **bước 2 đóng 10/09, bước 4 đóng 20/09** — và giữ
nguyên chuỗi cũ, kèm lý do giữ: nó là LÝ DO guard ấy mặc-định-đóng, không phải mô tả hiện
trạng. Bịt hai mắt xích không làm lý do yếu đi.

**(3) Người dùng không được báo trước khi mất phiên.** API trả kèm `attemptsLeft` ở **ba**
cửa — gõ sai mã lúc đăng nhập, gõ sai mã ở cửa két, và (từ A-02) gõ sai mật khẩu ở cửa cài
2 lớp — nhưng **không màn nào đọc con số đó**. Người gõ nhầm thấy "sai mã, sai mã, sai mã,
sai mã" rồi đột ngột bị đá ra. Lỗ này **có sẵn từ trước**, không do đợt B tạo ra; đợt B chỉ
thêm cửa thứ ba vào đó.

Phép quyết định nằm **một chỗ** (`errorMessage` nhận thêm một tham số), câu chữ vẫn do màn
hình dựng bằng `t()` — `lib/` không kéo i18n vào, và DoD gạch 6 cấm chuỗi tiếng Việt cứng.

Và nó **chỉ nói khi còn ≤ 2 lần**. Báo ngay từ lần sai đầu thì tới lúc thật sự sát ngưỡng,
câu cảnh báo đã thành tiếng ồn quen tai. Chuyện này có hệ quả đo được: bài
`di-khap-giao-dien.spec.ts:8487` chốt **nguyên văn** `'Mã xác thực không đúng.'` sau MỘT lần
gõ sai — ngưỡng 2 giữ bài đó đúng như cũ, còn một bản "luôn cảnh báo" sẽ làm nó đỏ.

Hai đột biến, hai vế:

| Đột biến | Kết quả |
| --- | --- |
| Ngưỡng → 99 (luôn cảnh báo) | bài **"còn xa ngưỡng thì IM"** đỏ |
| Ngưỡng → 0 (không bao giờ cảnh báo) | bài **"sát ngưỡng thì nói thẳng"** đỏ |

> Vế phủ định ở đây không phải cho đủ bộ. Một lời cảnh báo bật ở mọi lượt sai là một lời cảnh
> báo không ai đọc — và lúc nó thật sự quan trọng thì mắt đã lướt qua nó bốn lần rồi.

### 17.6 Kiểm chứng sau trọn đợt B

| Cổng | Sau đợt A | Sau đợt B |
| --- | ---: | ---: |
| lint api · web · e2e (`--max-warnings=0`) | 0 | **0** |
| depcruise api · web | no violations | **no violations** |
| Jest đơn vị | 55 suite / 926 | 57 suite / **942** |
| `test:db` (DB thật) | 14 / 74 | 15 / **80** |
| Vitest | 44 file / 370 | 45 file / **375** |
| Playwright | 443 | **450** |

**Chín lượt gieo đột biến, cả chín đỏ đúng chỗ** — và hai trong số đó nói ra điều mà một lượt
"chạy thử cho chắc" không bao giờ nói được:

| Đột biến | Kết quả |
| --- | --- |
| Tắt cổng xác thực lại của A-02 | **3 bài đỏ**, và bài "luồng cài lần đầu được miễn" vẫn **xanh** — đúng phân vai |
| `if (!totpPending) return false` → `return true` | bảng dữ liệu đỏ đúng hàng "phiên đã đăng nhập đủ" |
| Gỡ nhánh thu hồi phiên | `Expected "SESSION_REVOKED", Received "CURRENT_PASSWORD_WRONG"` |
| Gỡ cửa mới khỏi `PROBE_ACTIONS` | thư cảnh báo không bao giờ tới |
| Trả `endDate` về phép ghép `??` | SSL lại xoá được hạn; hai bài kia vẫn xanh |
| Gỡ `REAUTH_REQUIRED` khỏi danh sách loại trừ 401 | `expected '/login' to be null` — và bản ĐẦU của bài đó để đột biến này SỐNG SÓT (xem 17.1) |
| **Gỡ câu `REVOKE` khỏi 0048** | `Expected "42501", Received "P0001"` |
| Ngưỡng cảnh báo → 99 | bài "còn xa ngưỡng thì IM" đỏ (17.5) |
| Ngưỡng cảnh báo → 0 | bài "sát ngưỡng thì nói thẳng" đỏ (17.5) |

Hàng `REVOKE` là hàng đáng đọc lại. Bỏ hẳn nó mà `UPDATE audit_log` **vẫn ném lỗi** —
trigger bắt nó. Một bài kiểm viết kiểu "câu lệnh này phải ném" sẽ XANH với bản vá đã bị gỡ
mất, và AD-9 lại quay về là một câu nói đúng về giấy tờ. Chỉ vì bài chốt **mã lỗi** nên nó
phân biệt được "có hàng rào" với "có ĐÚNG hàng rào".

> Lint của chính repo bắt được một lỗi của tôi trong lúc làm D-01: `logger.error(error.message)`
> ở pool migration — luật NFR-04 "đừng ghi `.message` của lỗi ra log, nó chở cả tham số đã
> bind". Đúng loại rò rỉ mà không ai đọc code review nào bắt được. Cổng dựng ở đợt A trả lãi
> ngay trong đợt B.

---

## 18. Rà soát chéo Lượt 1 + 2 — 21/09/2026

> Commit `136c532`, trong đó gọi là **"rà soát chéo đợt A+B"**.

Bốn tầng đọc độc lập trên `master..HEAD` (6 commit, 99 file, 7.500 dòng sau khi lọc nhiễu
xuống dòng): **Blind Hunter** (24 mục) · **Edge Case Hunter** (22) · **Verification Gap** (9) ·
**Acceptance Auditor** (15). Gộp trùng và bỏ nhiễu còn **39**.

Tầng Acceptance Auditor được giao một việc khác thường: **chính tài liệu này vừa là chuẩn đối
chiếu vừa nằm trong diff.** Mục 16, mục 17 và các ô tick ở mục 8 do cùng một người viết mã
viết ra, trong cùng commit. Nên câu hỏi giao cho nó là: *ô nào tick mà thực ra chưa làm tới
nơi.* Nó tìm được hai — R-03 và R-04 dưới đây, cả hai đã tự kiểm lại bằng cách mở mã ra đọc.

Mọi mục dưới đây đã được kiểm chứng trên mã nguồn, không chấm theo lời kể của reviewer.

### Review Findings

- [x] [Review][Decision] **Cổng D-01 chỉ ném ở `NODE_ENV=production`** — staging/preprod chạy bằng superuser mà chỉ có một dòng `logger.warn`. Đảo thành "ném ở mọi nơi TRỪ development/test"? Đổi lại: stack E2E hoặc máy dev của người khác có `.env` cũ sẽ chết lúc boot thay vì kêu to. [api/src/main.ts:55]
- [x] [Review][Decision] **Mười định danh tiếng Việt MỚI sinh ra trong chính commit lập cổng AD-16** — lớp 1 chỉ bắt chữ CÓ DẤU nên `ngayCachDay`, `CON_10_NGAY`, `gaLapFetch`, `nhan`, `truoc`, `ghi`, `gia`, `giu`, `KHOA_DUNG_DONG` lọt hết. Mục 16.7 chấm rủi ro chờ-lớp-2 là "THẤP vì cả đội đang chủ động xoá chúng"; lượt này là phản chứng đo được. Đổi tên ngay trong đợt này, hay giữ kế hoạch gộp vào đợt G?

- [x] [Review][Dismiss] ~~A-01 mới đóng NỬA cửa~~ — **BÁC BỎ sau khi đọc mã, 21/09.** Hai tầng rà soát báo `POST /devices {"status":"retired"}` là một lỗ, vì `create()` không gọi `assertNotRetiringViaUpdate`. Nhưng `device-import.ts:423-427` đã quyết định ngược lại, có ghi lý do: tạo mới một máy đã thanh lý là việc THẬT (nạp kho lịch sử lần đầu), và một bản ghi vừa sinh ra chưa giữ IP/NAT/ghế license nào để mà dọn — tức đúng câu mà chốt `setStatus` sinh ra để hỏi. `POST` đi cùng đường với import-create, và đường đó cố ý mở. Thứ SAI là **ô tick §8.1**, đã sửa. Ghi lại nguyên mục này thay vì xoá: một finding bị bác bỏ mà không để lại vết thì lượt rà soát sau sẽ tìm ra y hệt, và lần sau có thể không ai mở nhánh create của đường Excel ra đọc.
- [x] [Review][Patch] A-03 sót một nơi: quét dùng mẫu `?? current?.` nên bỏ lọt biến thể `?? before.`. `PATCH {"note": null}` bị nuốt — người dùng xoá ghi chú, hệ thống giữ ghi chú cũ, không một dòng lỗi. [api/src/modules/ipam/nat-rule.service.ts:244]
- [x] [Review][Patch] `stepup_failures` được cửa enroll CỘNG mà không bao giờ TRỪ: gõ đúng mật khẩu không xoá bộ đếm. Sai 4 lần rồi gõ đúng ⇒ lần gõ hụt mã đầu tiên ở cửa két sau đó thu hồi phiên, kèm câu "Gõ sai mã 5 lần" nói sai sự thật. Docblock `session.service.ts:113` viết "số lần sai LIÊN TIẾP" — thực tế là tích luỹ vĩnh viễn. [api/src/modules/auth/auth.service.ts:511]
- [x] [Review][Patch] `assertNarrowRole` — hàng rào triển khai DUY NHẤT của D-01 — không bài kiểm nào chạy vào. Gỡ hẳn câu `throw` thì Jest, test:db, Vitest, build và cả lượt E2E đầy đủ đều xanh, vì mọi lượt chạy đều ở cấu hình ĐÚNG và hàm thoát ở dòng 54. [api/src/main.ts:52]
- [x] [Review][Patch] `0048` cấp `UPDATE, DELETE` cho cả 9 bảng chỉ-thêm mà `0039` liệt kê; chỉ `audit_log` có câu REVOKE. Chín bảng kia vẫn chỉ dựa vào trigger — đúng thứ mà chính migration này lập luận là chưa đủ. [api/src/migrations/0048_app_role_split.sql:48]
- [x] [Review][Patch] AD-16 có vùng mù: luật chỉ cắm trong khối `files: ['src/**/*.ts']`, nên **`api/test/**` chưa bao giờ được nó soi** — đúng tầng mà đợt này vừa thêm file mới. Khối ở `:291` khai lại `RESTRICTED_SYNTAX` cho hai file `audit` mà không kèm AD-16. [api/eslint.config.mjs:190]
- [ ] [Review][Patch] `stripComments` hứa "cắt nhầm chỉ có thể làm bài kiểm ĐỎ, không bao giờ làm nó xanh sai" — sai với sáu khẳng định PHỦ ĐỊNH đang gọi nó (`vault-surface.spec.ts:34,125,174,224,245,267`). Với khẳng định phủ định, cắt thừa làm bài XANH SAI. [api/src/test/source-text.ts:43]
- [x] [Review][Patch] Bài "không nhầm khoá kế thừa từ prototype" KHÔNG THỂ ĐỎ: nó chỉ thử `'endDate'`, mà `'endDate' in {}` là `false` với cả hai cách viết. Ca thật là `'toString'`. [api/src/common/merge-effective.spec.ts:52]
- [x] [Review][Patch] AD-16 được ba cấu hình lint viện dẫn trong thông điệp lỗi nhưng KHÔNG tồn tại trong `ARCHITECTURE-SPINE.md` lẫn `CLAUDE.md`. Người bị lint chặn hôm nay không tra được nó ở đâu. [web/eslint.config.mjs:58]
- [ ] [Review][Patch] Chú thích deps khẳng định `.mutate` của TanStack v5 ổn định — nhưng thứ đưa vào deps là OBJECT mutation, dựng lại mỗi render. `columns` nay tính lại ở mọi render, đúng cái bẫy mà cùng lượt sửa này đang vá cho `kindLabel` và `refresh`. [web/src/features/admin/accounts-screen.tsx:392]
- [ ] [Review][Patch] `errorMessage(..., nearLimit)` đấu vào BA cửa, chỉ MỘT cửa có bài canh. Xoá tham số thứ ba ở cửa két thì mọi cổng vẫn xanh. [web/src/ui/step-up-dialog.tsx:76]
- [x] [Review][Patch] `worker` thừa hưởng `*api_env` nên mang `MIGRATION_DATABASE_URL` (DSN chủ sở hữu) suốt vòng đời dù không bao giờ chạy migration; nó cũng không chạy `assertNarrowRole`. Chú thích `main.ts:20` đúng về POOL nhưng dễ đọc thành đúng về QUYỀN. [docker-compose.yml:78] — **ĐÃ LÀM 21/09** (worker thôi mang DSN chủ sở hữu — tách anchor `x-app-env`)
- [x] [Review][Patch] Cổng vai trò thiếu câu hỏi thứ ba: `GRANT ims TO ims_app` cho thừa kế trọn quyền chủ sở hữu trong khi `rolsuper` = false và `relowner` ≠ current_user ⇒ cổng vẫn ĐẬU. Thiếu `pg_has_role`. Kèm: `relname = 'audit_log'` không khoá schema lẫn `relkind`. [api/src/database/app-role.ts:66] — **ĐÃ LÀM 21/09** (cổng thêm câu hỏi `pg_has_role(...,'MEMBER')` + `to_regclass` chỉ đích danh bảng)
- [x] [Review][Patch] `ensureAppRole` bị bỏ qua IM LẶNG khi thiếu `APP_DB_PASSWORD`, và `REQUIRED_ENV` không kê hai biến mới — nơi cài quên biến sẽ chạy nửa vời rồi chết bằng một câu lỗi xác thực không chỉ ra chỗ hỏng. [api/src/main.ts:34] — **ĐÃ LÀM 21/09** (khai MIGRATION_DATABASE_URL mà thiếu APP_DB_PASSWORD → NÉM, không bỏ qua im lặng)
- [x] [Review][Patch] `APP_DB_USER` là núm không nối dây: `.env.example`, `docker-compose.yml` và `api/test/db.ts` đọc nó, nhưng `main.ts:15` và 9 câu lệnh trong `0048` viết cứng `ims_app`. Đặt khác đi ⇒ một `.env` hợp lệ, một role chưa từng được tạo, một API không boot. [.env.example:12] — **ĐÃ LÀM 21/09** (bỏ hẳn núm `APP_DB_USER` — nó không nối dây được vì 0048 đã cố định tên role)
- [ ] [Review][Patch] `gate-eol.sh` KHÔNG loại trừ `api/src/migrations/*.sql`. Các file đó khai `-text` vì checksum băm byte thô; làm theo đúng chỉ dẫn sửa mà chính cổng in ra sẽ làm vỡ checksum một migration ĐÃ ÁP và mọi DB không boot lại được. [ops/gate-eol.sh:40]
- [ ] [Review][Patch] Lint của `e2e/` không có cổng chặn merge — `ci.yml` chỉ có job `e2e-typecheck` chạy `tsc --noEmit`. AD-16 ở đó lại đặt mức `warn`. Bảng §16.8 xếp "e2e lint" cạnh hai dòng web/api vốn LÀ cổng GitHub, nên đọc ra thành cả ba đều chặn merge. [.github/workflows/ci.yml:84]
- [ ] [Review][Patch] `moduleEnabled` trả `true` khi khu RỖNG hoặc KHÔNG TỒN TẠI — tên ngược hẳn với giá trị, ở đúng một lượt đổi tên nhằm làm tên dễ đọc hơn. [web/src/features/devices/device-detail.tsx:363]
- [ ] [Review][Patch] `Combobox` không phân biệt "đang tải" với "không có gì khớp": trong lúc danh mục dịch vụ còn tải, người dùng được mời đi khai trùng một dịch vụ đã có. Có `failed`, chưa có `pending`. [web/src/ui/combobox.tsx:147]
- [x] [Review][Patch] `ALTER ROLE … LOGIN PASSWORD '…'` chạy ở MỌI lần boot, mật khẩu nằm trong văn bản câu lệnh — với `log_statement=ddl` là nó vào log dạng rõ. Chỉ nên chạy khi mật khẩu thật sự đổi. [api/src/database/app-role.ts:116] — **ĐÃ LÀM 21/09** (thử đăng nhập trước; đúng mật khẩu rồi thì không ALTER ROLE nữa)
- [ ] [Review][Patch] `api/src/test/source-text.ts` chưa khai vào `SHARED-REGISTRY.md` — DoD gạch 4. Bốn bài đã dùng chung nó; người anh em bên web (`quetNguon`) thì có hẳn một dòng. [docs/SHARED-REGISTRY.md]
- [ ] [Review][Patch] `@IsOptional` cho `null` đi qua, nên `{"currentPassword": null}` không rơi vào nhánh `REAUTH_REQUIRED` (chỉ xét `=== undefined`) mà rơi vào nhánh sai mật khẩu — tiêu một lượt đoán. Cùng hình dạng với `kind`/`licenseModel` bên software. [api/src/modules/auth/auth.dto.ts:26]
- [ ] [Review][Patch] `routesOf` lấy `prev.endsWith('{')` làm ranh giới khối, nên `@Throttle({` viết xuống dòng sẽ cắt cụt và báo một route ĐÃ khai `@Roles` là thiếu. Hôm nay chưa nổ vì cả 4 chỗ đều viết một dòng — mìn chờ lượt `prettier` đầu tiên. [api/src/test/source-text.ts:128]
- [x] [Review][Patch] `ignoreKnown` ngược nghĩa: biến giữ các vùng script dọn được mà KHÔNG bài nào gọi tới, tức "bị bỏ quên", không phải "bỏ qua cái đã biết". Câu lỗi ngay dưới vẫn mô tả nghĩa cũ. [e2e/tests/reset-domains-rollcall.spec.ts:76]
- [x] [Review][Patch] E2E viết cứng `maxFailures = 5` — DoD gạch 8. Đổi `secret.stepup_max_failures` trong `system_config` làm bài đỏ vì lý do không liên quan tới thứ nó canh. [e2e/tests/totp-enroll-reauth.spec.ts:151]
- [x] [Review][Patch] `reset-e2e.mjs` lùi về `DATABASE_URL` trong im lặng: nơi cài ĐÃ tách role mà quên biến mới sẽ chết giữa một lượt dọn dở dang bằng đúng câu `must be owner of table catalog_history`. Nên kiểm quyền MỘT lần trước khi bắt đầu. [api/scripts/reset-e2e.mjs:359] — **ĐÃ LÀM 21/09** (hỏi quyền MỘT lần trước khi xoá dòng nào — dọn dở dang tệ hơn không dọn)
- [ ] [Review][Patch] Câu lỗi `@Length(1, 200, { message: 'Chưa nhập mật khẩu hiện tại.' })` nói sai cho nhánh QUÁ DÀI. [api/src/modules/auth/auth.dto.ts:28]
- [ ] [Review][Patch] `SELECT setseed(0.42)` vô tác dụng — 305 dòng còn lại không gọi `random()` lần nào. Để nguyên là dạy người sau rằng thêm `random()` vào đây vẫn tái lập được. [ops/seed-demo.sql:33]
- [x] [Review][Patch] Tài liệu này thiếu hẳn mục 16.6 (nhảy 16.5 → 16.7); và §16.7 còn mô tả `nat.serviceEmpty` như một khoản nợ, trong khi đợt B đã đấu dây xong. [docs/RA-SOAT-TOAN-DIEN-2026-09-19.md:1461]
- [x] [Review][Patch] Chú thích `main.ts` hứa "mọi nơi cài cũ vẫn phải chạy được", nhưng `docker-compose.yml:45` chặn cứng bằng `${APP_DB_PASSWORD:?…}` — mọi `docker compose up` với `.env` chưa cập nhật chết trước khi Node chạy dòng nào. [api/src/main.ts:23] — **ĐÃ LÀM 21/09** (chú thích thôi hứa "nơi cài cũ vẫn chạy" — compose chặn cứng trước khi Node chạy)
- [ ] [Review][Patch] `gate-eol.sh` dùng danh sách CHO PHÉP đuôi tệp nên bỏ lọt `Dockerfile`, `web/nginx.conf`, `.env.example` — đúng loại tệp bị script sửa và đọc theo dòng. Thêm: `set -e` làm "cổng hỏng" và "có file lẫn EOL" trông giống nhau. [ops/gate-eol.sh:38]
- [ ] [Review][Patch] Bài canh cổng lint không bao giờ dùng tên `*.test.tsx` (probe luôn là `probe.tsx`), nên ngoại lệ CỐ Ý ở `web/eslint.config.mjs:181` — giữ AD-16 cho file test thay vì `'off'` trọn gói — không được bài nào ghim lại. [web/src/lint-rules.test.ts:40]
- [ ] [Review][Patch] `{...window.location}` trong jsdom cho ra object gần như rỗng (thuộc tính `Location` là accessor trên prototype), nên `location.origin`/`pathname` là `undefined`. Bài hiện xanh vì đường đi này không đọc chúng — may, không phải thiết kế. [web/src/features/auth/totp-enroll-reauth.test.tsx:108]
- [ ] [Review][Patch] `Combobox` nuốt phím Enter khi lọc ra 0 option: form không submit, không lời giải thích. [web/src/ui/combobox.tsx:228]

- [x] [Review][Defer] `ChangePasswordDto` mang cùng lỗi câu thông báo `@Length` — có trước đợt A, bản vá chỉ chép lại. [api/src/modules/auth/auth.dto.ts:34] — deferred, pre-existing
- [x] [Review][Defer] `ensureAppRole` có thể đua `CREATE ROLE` (SQLSTATE 42710) nếu hai tiến trình boot song song; compose hiện chỉ dựng một `api`. [api/src/database/app-role.ts:112] — deferred, pre-existing
- [x] [Review][Defer] `api/test/db.ts` dùng `encodeURIComponent` cho mật khẩu còn `docker-compose.yml` thì không — lệch nếu mật khẩu chứa `%`. `.env.example` đã ràng buộc bộ ký tự, nên chưa nổ. [api/test/db.ts:85] — deferred, pre-existing

**Bỏ đi 7 mục nhiễu:** năm chỗ `?? before.` ở `device-ports`, `ip-address`, `subnet`, `vault`
(dựng nhãn audit và câu lỗi, không phải phép ghép bản sửa) · trường `_lint_note` trong
`package.json` (npm bỏ qua khoá lạ, lý lẽ đáng giữ) · `audit.append` ném trước khi tăng bộ đếm
(chỉ xảy ra khi DB đã chết, lúc đó mọi thứ đã hỏng).

### 18.1 Đã xử ngay trong lượt — 21/09/2026

Mười hai mục, mỗi mục một bài kiểm ĐỎ trước khi vá. Ba mục đáng đọc lại vì chúng nói về
chính cách đợt B tự kiểm tra mình:

**Phép quét hẹp cho cảm giác đã soi hết.** Đợt B quét mẫu `?? current?.` và sửa ba file,
rồi mục 17.2 khai là xong. `nat-rule.service.ts` đặt tên biến cũ là `before` nên không lọt
vào mẫu — mười dòng ghép `??` liền nhau sống sót. Bài đỏ viết ra còn lòi thêm một lỗi mà
không tầng reviewer nào nêu: `PATCH /ipam/nat/:id {"deviceId": ""}` trả **500** (`22P02` từ
Postgres) thay vì 400, vì `NatBodyDto` cố ý cho chuỗi rỗng qua cửa DTO với lập luận
"`requireDeviceId()` ở POST sẽ bắt" — lập luận đúng với POST và không đúng với PATCH.

**Tài sản dùng chung có hợp đồng NGẦM.** Vá `nat-rule` bằng `effectiveOf` xong thì bài đỏ
theo chiều ngược: `{note: null}` trả `FIELD_REQUIRED: Chưa chọn router`. Lý do —
`effectiveValue` hỏi `field in values`, mà controller dựng object ĐỦ KHOÁ, khoá không gửi
mang `undefined`. Ba nơi đợt B sửa thoát nạn chỉ vì `values` ở đó do `put()` dựng, và
`put()` bỏ qua `undefined`. Tức hàm dùng chung đang sống nhờ một điều kiện mà nơi gọi phải
nhớ, và nơi gọi thứ tư không nhớ. Nay nó tự đứng vững (`hasOwnProperty` + coi `undefined`
là vắng mặt) — và đó cũng là mục mà bài kiểm cũ ĐẶT TÊN nhưng không canh: ca thật là
`'toString' in {}` (`true`), không phải `'endDate' in {}` (`false` với mọi cách viết).

**Cổng không ai canh thì không phải cổng.** `assertNarrowRole` nằm trong `main.ts` nên không
bài kiểm nào chạm tới được — `main.ts` gọi `bootstrap()` ngay lúc nạp module. Đã đo: gỡ hẳn
câu `throw` thì Jest, test:db, Vitest, build lẫn E2E đều xanh. Chuyển sang `database/
app-role.ts`, thêm bốn ca, và đảo luôn danh sách môi trường thành CHO PHÉP (R-01). Cùng hình
dạng ở AD-16: luật chỉ nằm trong khối `files: ['src/**']` nên cả tầng `api/test/**` chưa bao
giờ được soi, và khối ngoại lệ `audit` khai lại mảng luật thì đánh rơi BA luật trong khi chú
thích của chính nó nói là bỏ một — kèm cả NFR-04, ở đúng file ghi log lỗi.

| Đo được | Trước | Sau |
| --- | ---: | ---: |
| Jest đơn vị | 943 | **948** |
| Tầng chạm DB thật | 80 | **103** |
| Vitest | 375 | 375 |
| Migration | 48 | **49** |
| Định danh tiếng Việt do đợt A+B đẻ ra | 10 | **0** |

Và một mục bị **BÁC BỎ**: xem dòng A-01 ở trên. Hai tầng cùng báo một lỗ không tồn tại vì cả
hai đọc `create()` thấy thiếu chốt rồi suy ra hậu quả, không ai mở nhánh create của đường
Excel — nơi có sẵn một quyết định ngược lại kèm lý do. Con số "hai tầng cùng nói" không phải
bằng chứng; nó chỉ là hai lần cùng một cách đọc.

Hai mươi bốn mục còn lại vẫn là ô trống ở trên — việc tồn đọng, không phải việc đã quên.

## 19. Lượt 3 — sáu mục CAO của backend (ĐÃ LÀM 21/09/2026)

> Commit `df0899a`, trong đó gọi là **"đợt C"**. Lượt này vá các mục mang mã **A-**04·05·06·07·08·11
> — một lượt tên "C" chứa toàn mã "A", và đó chính là lý do cái tên bị bỏ.

Sáu ô trống cuối cùng của mục 8.3: A-11 · A-04 · A-05 · A-06 · A-07 · A-08. Mỗi mục một bài
kiểm ĐỎ trước, rồi mới vá.

| Mục | Bài kiểm đỏ trước khi vá |
| --- | --- |
| **A-04** | hai kết nối thật cùng khai `TCP/8080` và `BOTH/8080` trên một router → cả hai lọt, sổ có hai câu trả lời |
| **A-05** | trần seat hạ 5→1 trong lúc lượt gán đang chờ khóa → ghế thứ hai vào license 1 ghế, không lỗi, không cảnh báo |
| **A-06** | gán máy cho IP `reclaimed` → hàng lai `device_id` + `reclaimed`; rồi `holdingsOf` trả về nó và `releaseWithin` ném `IP_TRANSITION_INVALID` |
| **A-07** | lượt quét toàn `src/modules` tìm thấy đúng **một** vi phạm: `audit` đọc bảng `users` bằng SQL thô |
| **A-08** | dashboard hỏi module `expiry` với cửa sổ `30`, ghi đè `expiry.warning_days` |
| **A-11** | `{cabinetId, siteId: ""}` qua cửa trọn vẹn — bốn ca đỏ, năm ca đối chứng xanh |

### 19.1 A-04 — chỗ đáng bàn nhất: thêm một cái khóa, hay đổi ràng buộc

Mục 8.3 ghi sẵn cách vá: *"đưa `siblings` vào trong transaction + khóa hàng `device`"*. Cách
ấy chạy được. Nhưng nó đẻ ra một **quy ước**: "ai ghi vào `nat_rule` thì nhớ khóa router
trước". Và quy ước là thứ người ta quên — cả đợt rà soát 19-21/09 này, **sáu trên sáu** lỗ
đều là một quy ước bị quên ở đúng một cửa trong nhiều cửa. Thêm một quy ước nữa để vá hậu quả
của những quy ước bị quên là đi vòng quanh.

Ràng buộc DB thì không quên được. Mẹo: ánh xạ giao thức thành một **khoảng** rồi hỏi `&&`
thay cho `=` —

    tcp → [1,1]        udp → [2,2]        both → [1,2]

`tcp && udp` rỗng nên hai giao thức riêng vẫn khai chung port được, đúng thứ Draytek cho phép
và migration `0022` cố ý chừa. `tcp && both` khác rỗng nên bị chặn, **ở mọi mức đồng thời,
không cần khóa nào**. Không phải thêm extension: `btree_gist` đã có từ `0022`.

Phép kiểm trong service KHÔNG gỡ — nó vẫn là đường cho câu lỗi tử tế (nói rõ đụng rule nào).
Nó chỉ thôi làm **trọng tài duy nhất**.

Migration `0050` tự hỏi trước xem dữ liệu đang chạy có cặp nào phạm luật mới không, và nếu có
thì `RAISE EXCEPTION` nêu đích danh từng cặp kèm việc phải làm. Migration chạy trước
`app.listen`, nên một câu `23P01` trần trụi ở đó là một api không lên được cộng một câu lỗi
không nói phải làm gì.

### 19.2 A-07 — cổng thứ ba, cho cái cửa hai cổng kia mù

`LEFT JOIN users u ON u.email = a.actor` sống chín epic dưới mũi **hai** cổng AD-2:

- eslint `no-restricted-imports` khớp **chuỗi import** — ở đây không có import nào;
- `dependency-cruiser` khớp **đường dẫn đã resolve** — một câu SQL không resolve thành gì cả.

Hai cổng, cùng một điểm mù, hình dạng là "ranh giới bị phá bằng một công cụ khác công cụ mà
cổng biết đọc". `ad2-raw-sql.spec.ts` đọc chủ sở hữu bảng từ chính các `*.schema.ts` (AD-3,
không phải danh sách chép tay) rồi quét mọi file đã lột chú thích. Quét trọn file chứ không
bóc riêng khối ``sql`…` ``: một `${...}` lồng backtick sẽ cắt cụt khối, và khối bị cắt cụt thì
cổng lặng lẽ khớp ít đi — đúng lớp lỗi mục 16 vừa dọn hai lần.

Cổng có **ba ca đối chứng phủ định** và **sáu ca khẳng định** trước khi tin lượt quét: một
cổng khớp đúng số không chuỗi trông y hệt một cổng không có gì để bắt.

### 19.3 Một bài kiểm không có răng, bắt được bằng đột biến

Bài "email khác chữ hoa-thường vẫn ra tên" viết xong thì **xanh** — và vẫn xanh cả khi gieo
đột biến bỏ hẳn `.toLowerCase()`. Lý do: bài dàn cảnh "sổ lưu chữ thường, nhật ký ghi chữ
hoa", mà khóa map lúc ấy là chuỗi ĐANG LƯU nên vốn đã chữ thường; hai vế gặp nhau, bẫy không
bung. Bẫy thật ở chiều ngược lại — `citext` **chấp nhận lưu** `Chu.Hoa@PMH.com.vn` nguyên
dạng. Thêm chiều ấy vào bảng dữ liệu thì đột biến chết ngay.

Một bài kiểm xanh chưa nói lên điều gì cho tới khi có thứ làm nó đỏ.

### 19.4 Và hai chỗ dọn kèm, vì đang mở đúng file đó

- `dashboard.service.ts` cắt khối "sắp hết hạn" bằng số `8` viết tay trong khi `MAX_ITEMS = 8`
  nằm ngay đầu file, sinh ra đúng để mọi khối cắt cùng một chỗ.
- Câu từ chối "gắn tủ mà không khai site" nay là **một bản chữ** dùng chung cho cả cửa Excel
  lẫn cửa HTTP (`cabinetWithoutSiteMessage`). Vá xong mà mỗi cửa tự viết một câu thì hai câu
  sẽ trôi khỏi nhau đúng như hai phép kiểm vừa trôi khỏi nhau.

### 19.5 Đo được

| Đo được | Trước đợt C | Sau |
| --- | ---: | ---: |
| Jest đơn vị | 948 | **981** |
| Tầng chạm DB thật | 103 | **126** |
| Vitest | 375 | 375 |
| Migration | 49 | **50** |
| Vi phạm AD-2 bằng SQL thô | 1 | **0** |

Mục 8.3 còn **bốn** ô trống, đều là frontend (F-04 · F-05 · F-07 · F-10). Cả sổ mục 8 còn
**48** ô, mục 18 còn **23** — việc tồn đọng, không phải việc đã quên.

## 20. Lượt 4 — bốn mục CAO của frontend (ĐÃ LÀM 21/09/2026)

> Commit `3e3faf2`, trong đó gọi là **"đợt D"**. Lượt này vá các mục mang mã **F-**04·05·07·10.
> Đừng nhầm với **D-02**, một mã CSDL vẫn còn nguyên.

Bốn ô cuối của mục 8.3, và mục 8.3 **đóng lại** ở đây (13/13).

Nói thẳng một chuyện trước: đợt C tôi gom sáu mục backend rồi gọi đó là "đợt C" mà **không nói
là đang để bốn mục frontend ra ngoài** — trong khi chúng cùng mục, cùng hạng CAO. Nhãn A/B/C/D
không hề có trong sổ này; nó là cách tôi chia việc, và chia xong thì phải nói ra phần bị cắt.

| Mục | Bài kiểm đỏ trước khi vá |
| --- | --- |
| **F-04** | lượt quét CSS tìm thấy đúng **một** token phi-màu nằm ở ô cần màu |
| **F-05** | bấm ↓ hai lần rồi cha render lại → dòng sáng nhảy từ "Firewall" về "Switch" |
| **F-07** | `/verdict` trả 500 → Admin mất sạch panel Két sắt |
| **F-10** | hàng SỐNG gieo trước, hàng ĐÃ ẨN gieo sau → ô hiện chủ cũ đã gỡ |

### 20.1 F-10 — finding đúng, `file:dòng` sai, và lỗi thì rộng hơn

Sổ ghi F-10 ở `web/src/features/ipam/subnet-detail.tsx:289`. Mở ra thì file ấy **không còn
`Map` nào** — luồng web giờ là `filterSlots → pageSlots`. Rất dễ kết luận "đã vá rồi, tick đi".

Lỗi không biến mất. Nó **dời xuống api**, `IpAddressService.listBySubnet`:

    const byAddress = new Map(records.map((row) => [row.address, row]));

Nên nó còn rộng hơn lúc được ghi: hồi đó một màn sai, nay **mọi nơi gọi** đều sai.

`ip_address_key` là UNIQUE **một phần** (`WHERE voided_at IS NULL`), nên 1 hàng sống + N hàng
đã ẩn cùng địa chỉ là hợp lệ — và là đường đi bình thường (ẩn nhầm rồi cấp lại). `new Map` giữ
hàng CUỐI, mà "cuối" do Postgres quyết: `ORDER BY address` không định nghĩa thứ tự giữa hai
hàng CÙNG địa chỉ. Badge "Đã ẩn" cho địa chỉ đang dùng, bộ đếm "Đang cấp" hụt một, nút "Bật
lại" bày cho hàng đang sống → `IP_TAKEN`.

Bài học không nằm ở mười dòng code: **một finding ghi theo `file:dòng` sẽ lệch khỏi mã nguồn**,
và người đọc lại sau hai tuần rất dễ tick nhầm vì đường dẫn không còn khớp.

Luật mới (`keepPreferredByAddress`, hàm thuần): **sống thắng ẩn**; giữa hai hàng cùng ẩn thì
hàng ẩn SAU thắng. KHÔNG bỏ hàng ẩn đi — `restore()` cần một đường tới nó.

Bài kiểm để ở **hai tầng**, có lý do: bài DB gieo hàng theo một thứ tự rồi trông vào thứ tự
heap của Postgres để dựng lại thế thua — mà thứ tự ấy không phải hợp đồng. Nếu một ngày
Postgres trả ngược lại, bài DB sẽ **xanh trên một bản đã hỏng**. Bảng dữ liệu ở
`ip-rules.spec.ts` không phụ thuộc gì cả.

### 20.2 F-07 — một vế là lỗi thật, một vế thì sổ ghi mạnh hơn sự thật

**Vế (a) — lỗi thật.** `useOwnerSecrets` tính `allowed = isAdmin || …`, chú thích ở đó tuyên bố
thẳng *"SA/Admin không chờ `verdict`"*. Nhưng phần render đặt `if (verdict.isLoading)` và
`if (verdict.isError)` lên **trước** mọi thứ. `/vault/secrets/verdict` trả 500 là SA/Admin mất
sạch panel Két sắt — dù quyền của họ không phụ thuộc vào câu trả lời ấy, và danh sách ngăn đã
tải xong. Lại đúng hình dạng gặp bốn lần trong đợt này: chú thích mô tả đúng ý định, mã làm
việc khác.

**Vế (b) — KHÔNG tới được.** Sổ viết *"Member bị `denied` và chưa gửi phiếu nào vẫn đọc 'Đang
chờ duyệt'"*. Sai: `denied` làm `allowed` sai, và panel dừng ở `vault.noPermission` **trước
khi** chạm tới badge. Đây là finding thứ hai của cả đợt rà soát bị bác bỏ sau khi đọc mã (cái
đầu là A-01).

Nhưng thứ finding ấy **nhìn thấy** thì có thật: badge suy ra bằng phép LOẠI TRỪ, trong khi
server gửi hẳn `pending` sang. Hôm nay hai thứ trùng nhau vì
`canRequest = grant === null && pending === null`. Đó là một **sự trùng khớp giữa hai module**,
không phải một hợp đồng — thêm một lý do thứ ba làm `canRequest` sai là badge nói dối, im lặng.
`VaultPanel` là tài sản dùng chung (`web/src/ui`), nên đã đổi sang đọc `pending`, và nhánh cuối
có câu thật của riêng nó.

### 20.3 F-04 — cổng hỏi sai câu hỏi

`outline: 2px solid var(--ring)`. Tên token đúng, thuộc tính hợp lệ, không màu viết thẳng nào —
`gate-hex.sh` không có gì để nói. Nhưng `--ring` là **giá trị box-shadow**, nên dòng ấy không
parse được và trình duyệt **vứt cả khai báo**, im lặng. `<input>` thật bị `clip: rect(0 0 0 0)`
nên label là thứ duy nhất nhìn thấy: **Tab tới ô chọn file không có tín hiệu nào** (WCAG 2.4.7),
ở mọi hộp Import và mọi khu đính kèm.

Cổng cũ hỏi "có màu viết thẳng ngoài `tokens.css` không". Câu cần hỏi là khác: "token này có
dùng đúng KIỂU của nó không". `web/src/token-usage.test.ts` hỏi câu ấy — phân loại token bằng
chính giá trị trong `tokens.css` (lần theo cả `var()` trỏ sang token khác) rồi soi những thuộc
tính chỉ nhận `<color>`.

`background` CỐ Ý đứng ngoài danh sách: nó nhận cả `<image>`, và `--grad`/`--auth-bg` là
gradient dùng đúng chỗ ở bảy nơi. Một cổng bắt oan bảy chỗ đúng để bắt một chỗ sai là một cổng
sẽ bị tắt — bản nháp đầu của tôi đúng như thế, và lượt quét thử trước khi viết đã lộ ra.

### 20.4 Hai lần bài kiểm của tôi đo nhầm thứ cần đo

- **F-05.** Bản đầu dựng một nút "Cha render lại" rồi bấm vào. Nó đỏ — nhưng đỏ vì bấm ra ngoài
  menu là **click ngoài**, và `Select` đóng menu theo đúng thiết kế. Tin nó thì tôi đã đi "vá"
  một hành vi đang đúng. Cảnh thật không có cú bấm nào: một query anh em trả về trong khi tay
  người dùng còn trên bàn phím.
- **Cổng EOL bắt tôi lần thứ ba.** Chèn chú thích F-10 vào một file CRLF bằng chuỗi `
` →
  `CR=974 LF=981`. Đúng cái bẫy đã ghi trong sổ tay, lặp lại lần thứ ba trong ba đợt.

### 20.5 Đo được

| Đo được | Trước đợt D | Sau |
| --- | ---: | ---: |
| Jest đơn vị | 981 | **991** |
| Tầng chạm DB thật | 126 | **131** |
| Vitest | 375 | **392** |
| Cổng tĩnh mới | — | `token-usage.test.ts` |

**Mục 8.3 đóng: 13/13.** Cả sổ mục 8 còn **44** ô, mục 18 còn **23**.
