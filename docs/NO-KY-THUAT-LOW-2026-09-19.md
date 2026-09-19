# Nợ kỹ thuật mức LOW — gom từ đợt rà soát 18/09/2026

Sáu chuyên gia soi song song nhánh `feat/ui-chi-tiet-v2` (12 commit, 92 file, ~10.6k dòng).

> **Đính chính 19/09:** con số trên là của LƯỢT RÀ 18/09 (sáu chuyên gia, 12 commit đầu của
> nhánh). Đừng đọc lẫn với mục "Đợt rà soát 19/09/2026" trong `docs/EPIC-MAP.md` — lượt đó là
> **bảy** chuyên gia trên **16** commit, rồi một lượt thứ ba (`/bmad-code-review`, bảy lớp) trên
> **21** commit / 68 file. Ba lượt khác nhau, ba bộ số khác nhau; tên file ghi `-2026-09-19` vì
> nó được VIẾT ngày 19/09, còn nội dung gom từ lượt 18/09.
Kết quả: **1 BLOCKER · 15 mục báo HIGH · ~26 MEDIUM · ~28 LOW**.

BLOCKER, HIGH và MEDIUM **đã xử hết** trong 12 commit của nhánh đó — mỗi bản sửa đều đo lại
trên trình duyệt thật hoặc gieo đột biến để chắc bài kiểm đỏ được. Ba mục báo HIGH bị hạ cấp
sau khi tự kiểm lại (một sai hẳn, một là quyết định có chủ ý, một chỉ là thẩm mỹ).

File này giữ phần **LOW còn lại**. Chúng có một điểm chung đáng nói: **phần lớn KHÔNG do nhánh
`feat/ui-chi-tiet-v2` sinh ra** — chúng là nợ cũ mà lượt rà soát này tình cờ chiếu đèn vào. Gom
về một chỗ để không phải rà lại lần thứ ba, và để lượt rà soát sau không báo lại thứ đã biết.

Thứ tự trong bảng là thứ tự tôi khuyên xử, không phải thứ tự phát hiện.

---

## 1. Hàng rào có mà không ai bật được

| # | Chỗ | Chuyện gì |
| --- | --- | --- |
| L-01 | `api/src/modules/config-sys/system-config.service.ts` — `setWithin()` | **0 nơi gọi trong toàn repo.** AD-11 nói tham số vận hành "chỉnh qua UI Admin", nhưng chưa có đường nào từ giao diện xuống hàm này. Hệ quả cụ thể: ba khoá `secret.probe_*` mà migration 0046 vừa thêm chỉ đổi được bằng `UPDATE` tay trên DB prod — trong khi chính migration ấy quảng cáo "đặt ngưỡng về 0 là TẮT cảnh báo… đường lùi không cần sửa code". Đường lùi đó hiện đi qua `psql`.  **Rà lại 19/09 — KHÔNG phải mục chưa quyết:** món "chưa có màn Admin sửa `system_config`" đã được hoãn CÓ CHỦ Ý ba lần, ghi trong `docs/EPIC-MAP.md` ở bảng nợ của Epic 1 ("AC Epic 1 chỉ yêu cầu seed + đọc"), Epic 3 ("chưa story nào cần") và Epic 6 ("sửa bằng SQL được" — hạn chót đặt là *"khi anh Thuận muốn tự đổi trần mà không cần tôi"*); `docs/CODE-REVIEW-2026-08-28.md:127` cũng đã nêu đúng câu "`setWithin` không có nơi gọi nào" từ 28/08. Dữ kiện MỚI mà ba lần hoãn kia chưa có: lý lẽ "sửa bằng SQL được" đúng cho trần break-glass, nhưng nay công tắc tắt của một cơ chế **cảnh báo an ninh** cũng nằm sau cùng cánh cửa ấy. Không sửa được chú thích trong 0046 để nói lại cho đúng: `database/migration-runner.ts` băm SHA-256 nội dung file và **fail to** khi lệch, nên file migration đã apply là bất biến. Câu đúng để đọc nó là "tắt được mà không phải sửa code và triển khai lại" — người tắt vẫn phải có quyền vào DB. |
| L-02 | `web/src/lint-rules.test.ts` | Cổng canh AD-15 (import chéo, `window.confirm`) nhưng **không canh chuỗi tiếng Việt cứng**. Nên mục L-03 dưới đây không có gì ngăn nó lớn thêm. |

## 2. Chuỗi tiếng Việt viết cứng (không qua `lib/i18n`)

| # | Chỗ | Ghi chú |
| --- | --- | --- |
| L-03 | `web/src/ui/import-preview.tsx` | Cụm lớn nhất. Nhãn `Thêm mới / Cập nhật / Không đổi / Bỏ qua / Lỗi` khai **hai lần trong cùng một file**, trong khi `vi.ts` đã có sẵn nhánh `importPreview.*` |
| L-04 | `web/src/ui/schedule-picker.tsx` | Bảy tên thứ trong tuần + ba câu mô tả lịch |
| L-05 | `web/src/features/catalog/catalog-form.tsx` | Năm câu báo lỗi kiểm tra dữ liệu |
| L-06 | `web/src/features/catalog/catalog-import-dialog.tsx` | Ba nhãn thực thể |
| L-07 | `web/src/features/auth/*`, `web/src/features/admin/account-form.tsx` | Bảy câu lỗi dự phòng trong `errorMessage(err, '…')` |
| L-08 | `web/src/features/admin/accounts-screen.tsx` | Một template lai + hai `<th>` |
| L-09 | `web/src/ui/time-picker.tsx` | `ariaLabel="Giờ"` / `"Phút"` |
| L-10 | `web/src/ui/history-panel.tsx` | `emptyText` mặc định |

**KHÔNG tính vào đây** (đã kiểm, là hợp lệ): `t('key', 'chuỗi dự phòng')` ở `load-state.tsx`,
`select.tsx`, `date-time-picker.tsx` — đó là tham số mặc định đúng cách của i18next. Và
`features/dev/components-gallery.tsx` — màn nội bộ `/dev/components`, không phải màn người dùng.

## 3. CSS chết — khai trong `.css` nhưng không `.tsx` nào dùng

| # | Cụm | Số class |
| --- | --- | --- |
| L-11 | `.dm-*` · `.dmboard` · `.dmcol` · `.dmrow` · `.dmtabs` | Cả khối cho **một màn không tồn tại** |
| L-12 | `.skeleton` · `.skeleton-block` · `.skeleton-title` | 3 |
| L-13 | `.sw-opt-name` · `.sw-opt-meta` · `.sw-opt-badge` | 3 |
| L-14 | `.session-list` · `.session-idx` · `.session-time` · `.session-toggle` · `.session-detail-row` | 5 |
| L-15 | Lẻ: `.config-page` `.config-nums` `.bulk-toolbar` `.bulk-count` `.asset-grid` `.admin-narrow` `.toolbar` `.linkbtn` `.plb` `.pnode` `.transfer-btn` `.picked-input` `.profile-stat-card` `.lifecycle-toast` `.text-danger` `.muted-empty` `.due-today` `.overdue` `.stacked` `.slotchip` `.ra-ic` `.org` | 22 |

Nhánh `feat/ui-chi-tiet-v2` đã dọn được 4 chỗ cùng loại (`.detail-tabs-body`, `.vault-hits`,
`.vault-hit-list`, `.device-summary`) và ghi lý do vào chú thích. Cùng một lượt dọn xử nốt được
danh sách trên.

**Cẩn thận khi dọn:** vài class được dựng ĐỘNG (`` `kpi-${tone}` ``), nên grep chuỗi trần sẽ báo
nhầm là chết. Kiểm bằng cả hai lối trước khi xoá.

## 4. Chỗ còn sót của những bản sửa vừa làm

| # | Chỗ | Chuyện gì |
| --- | --- | --- |
| L-16 | `web/src/css/table.css:376` | `var(--surface-2, rgba(0,0,0,.03))` — giá trị dự phòng **không bao giờ chạy** vì `--surface-2` luôn có. Xoá được. |
| L-17 | `web/src/css/detail-tabs.css:338` | Icon kính lúp của ô tìm nằm trong data-URI SVG (`stroke='%238a908a'`). Biến CSS không vào được data-URI, nên icon **giữ nguyên màu xám ở chế độ tối**. Muốn sửa thì phải đổi sang `<svg>` thật hoặc `mask`. |
| L-18 | `web/src/css/relation-map.css:121-128` | `.rmap-node .rn-h { white-space: nowrap }` + `overflow: hidden` mà **không có `text-overflow: ellipsis`** — nhãn dài ("License đang cài") bị chém ngang giữa chữ, không dấu hiệu gì. Chỉ `.rn-i` có ellipsis. |
| L-19 | `web/src/css/relation-map.css` | 242 dòng, `@import` toàn cục ở `index.css`, nhưng chỉ **một** màn dùng (`device-detail.tsx`). Nếu vẫn chỉ một màn thì nên nằm cùng feature; nếu định dùng lại cho `software`/`isp` thì phải khai vào `docs/SHARED-REGISTRY.md` (hiện chưa có). |
| L-20 | `web/src/features/catalog/catalog-screen.tsx:78-85` | `.cell-note` cắt chữ ở `max-width: 180px`, câu đầy đủ chỉ tới được qua `title=`. `title` **không mở được bằng bàn phím** và nhiều trình đọc màn hình bỏ qua. Ở ≤960px nó tự nhả ra nên chỉ hỏng ở desktop. |
| L-21 | `web/src/ui/reveal-dialog.tsx:76` | `deps` là `[onClose, onExpire, graceTotal]` nhưng `vault-panel.tsx:401` truyền cả hai callback dưới dạng arrow **inline** → mỗi lượt render của cha là một lần `clearInterval` + `setInterval` mới. Chưa chết người vì `deadline` là ref cố định và nhịp 250ms; chỉ đứng hình nếu cha render dày hơn 250ms/lần. |
| L-22 | `web/src/ui/reveal-dialog.tsx` — `onExpire` | Đường thoát mới (két tự ẩn → mở một toast) **chưa có bài kiểm nào**; `reveal-dialog.test.tsx` không đổi dòng nào trong cả nhánh. |
| L-23 | `web/src/ui/dialog.tsx:353` | Provider độ sâu chỉ bọc `children`. Hộp mở ra từ `footer` hoặc `title` (hai prop đều nhận `ReactNode`) vẫn đọc `depth` của cha. Hiện chưa nơi nào làm thế, nhưng hợp đồng của prop không nói ra điều đó. |
| L-24 | `web/src/ui/dialog.tsx:120` | Chú thích prop `overlayClassName` **đã lỗi thời**: nó bảo hộp lồng "dùng `'modal-backdrop bare'`", mà từ 18/09 việc đó là tự động. Người đọc sẽ truyền tay rồi vô hiệu hoá chính cơ chế mới. |

## 5. Bộ kiểm — chỗ nói không đúng về thứ nó canh

| # | Chỗ | Chuyện gì |
| --- | --- | --- |
| L-25 | `e2e/tests/vault.spec.ts` — `stamp` | `Date.now().toString().slice(-6)` **lặp lại sau mỗi 1000 giây**. Email người dò là `e2e-tao-moi-do-ket-${stamp}@`. Hai lượt chạy trùng đúng 6 chữ số ms trong vòng 60 phút → thời gian nghỉ của lượt trước nuốt lá thư → bài đỏ với thông báo vô nghĩa. Dùng `crypto.randomUUID().slice(0,8)` cho **riêng** email người dò là đủ. |
| L-26 | `e2e/tests/vault-reveal.spec.ts:205-230` | Docblock "THU HỒI LÀ CHẤM DỨT" đặt **nhầm chỗ** — nó đứng trên bài `'mã 6 số đã dùng không dùng lại được'`, trong khi bài nó mô tả nằm dưới và không có chú thích. Người đọc sau sẽ tin sai về việc bài chống-replay đang canh gì. |
| L-27 | `e2e/tests/helpers.ts:193` | Chú thích mồ côi: dòng `/** Đếm số dòng audit … */` của `countAudit` nay đứng trên `lastAudit`, còn `countAudit` ở dưới không còn chú thích. |
| L-28 | `e2e/tests/di-khap-giao-dien.spec.ts` — ô số KPI | Chỉ được kiểm `aria-pressed="false"`, **chưa từng được bấm**. Đột biến `onClick={() => {}}` sống sót: ô sáng lên mà bảng không đổi. (Màn Sắp hết hạn đã có bài bấm thật từ 18/09; các màn khác thì chưa.) |

## 6. Vận hành — biết trước khi deploy

| # | Chỗ | Chuyện gì |
| --- | --- | --- |
| L-29 | `api/src/migrations/0046_secret_probe_alert.sql:42` | `CREATE INDEX` (không `CONCURRENTLY`) lấy **ACCESS EXCLUSIVE** trên `audit_log`. Trên DB đã tích dữ liệu, lượt migration này **chặn mọi lượt ghi audit**, tức chặn đăng nhập. Chấp nhận được ở quy mô hiện tại — chỉ cần biết trước. |
| L-30 | Cùng migration | `audit_log_actor_action_at_idx (actor, action, created_at)` gần trùng `audit_log_actor_idx (actor, created_at)` từ `0004`. Với bảng chỉ-thêm ghi rất dày thì hai index gần nhau là chi phí ghi thật. Đo rồi cân nhắc gộp (migration `0042` đã từng là lượt dọn đúng loại này). |
| L-31 | `SecurityProbeService` — cửa sổ nghỉ | Kẻ tấn công cố ý tạo đủ lượt thất bại "vô hại" để kích hoạt cảnh báo, rồi dò thoải mái trong thời gian nghỉ mà không sinh thêm thư. Vết trong `audit_log` vẫn đủ (mỗi lượt một dòng), và footnote của thư đã nói rõ "không phản ánh tổng số lượt" — nên đây là **đánh đổi có ý thức**, ghi lại để không ai coi con số trong thư là tổng. Muốn siết: gửi thư thứ hai khi số lượt vượt xa lần cảnh báo trước (vd ≥ 3× ngưỡng) dù đang nghỉ. |
| L-32 | `secrets/README.md` bước 3 | Job xoay chìa (`rewrap()`) **chưa tồn tại**, nên xoay chìa mới đạt một nửa: chìa mới dùng cho dữ liệu mới, chìa cũ **vẫn còn giá trị** với dữ liệu cũ. Nếu lý do xoay là *nghi chìa cũ đã lộ* thì mối nguy VẪN CÒN. README đã ghi rõ; nhắc lại ở đây để nó không bị chôn trong một file README. |

---

## Hai mục chờ quyết định, KHÔNG phải nợ kỹ thuật

Hai thứ dưới đây không nằm trong danh sách trên vì chúng cần một quyết định sản phẩm, không
phải một lượt dọn:

**A. Prop `dot` trên `ui/tabs.tsx`.** Khả năng cho tab đeo chấm cảnh báo đã viết đủ — prop, CSS
`.tab-dot`, chữ ẩn cho trình đọc màn hình (WCAG 1.4.1). Nhưng **0 màn truyền nó**, và hệ thống
chưa có tín hiệu nào sẵn sàng để quyết khi nào chấm sáng. Mockup `thiet-bi.html:510` có dùng
(tab Két sắt mang chấm) nhưng không nói chấm ấy nghĩa là gì.
→ **ĐÃ CHỐT 19/09/2026, commit `26f505d`: GỠ.** Prop, luật CSS `.tab-dot`/`.tab-dot.danger` và
chữ ẩn đều đã xoá. Lý do: hệ thống không có tín hiệu nào để quyết khi nào chấm sáng, và một khả
năng không ai đấu dây thì chỉ là chú thích tốn chỗ. Ngày nào chốt được chấm ấy báo điều gì thì
lấy lại trong git — lý do gỡ ghi ngay chỗ prop từng đứng.

**B. Khu "Hồ sơ" trên 4 trang chi tiết không có thẻ và tiêu đề.** Mockup vẽ
`<section class="card"><h2>Hồ sơ</h2><dl>…`; code render `<dl class="data-grid">` trần — không
nền, không viền, không landmark có tên. Mọi khu bên dưới đều là `<section class="card"
aria-labelledby>`, nên khu ĐẦU TIÊN lại là khu duy nhất lơ lửng.
→ **ĐÃ CHỐT 19/09/2026: TRẢ LẠI THẺ + TIÊU ĐỀ.** Dựng ở commit `26f505d`, rồi gom về một bản
dùng chung `DetailSection` (`ui/detail-layout.tsx`) ở commit `feba63b` — bản đầu chép nguyên văn
vào cả bốn file `features/`, vi phạm AD-15, và chính việc đó khiến hai khiếm khuyết trình bày của
nó phải vá bốn lần thay vì một.

**Hai mục trên đã được quyết trong chính lượt commit sinh ra tài liệu này**, nên bản đầu của file
vẫn hỏi "cần chốt" cho hai việc đã xong — lượt rà soát 19/09 chỉ ra. Ai đọc sau sẽ đi mở lại một
cuộc thảo luận đã kết thúc; sửa để không ai mất công thêm lần nữa.

---

## Ba bài học hạ tầng từ đợt này — đáng nhớ hơn cả danh sách trên

**1. `docker compose build` ở máy này KHÔNG đáng tin.** `COPY src ./src` trúng cache dù nguồn
đã đổi, và một lượt build THẤT BẠI thì `up -d --build` lặng lẽ chạy tiếp ảnh CŨ. Trong đợt này
đã có một lượt "9 bài vault xanh" chạy hoàn toàn trên code cũ và không chứng minh gì cả.
→ Cách duy nhất đáng tin là **xác minh hiện vật** sau mỗi lượt dựng:
`curl / | grep static/index-` đối chiếu với `web/dist/` cho web, và
`docker compose exec api grep <dấu hiệu> dist/...` cho api. Đáng đưa vào `ops/ci-local.sh`.

**2. `npm --prefix api run build` phải là cổng bắt buộc**, ngang `npm --prefix web run build`.
Nó bắt được ba lỗi kiểu mà `api lint` và 892 bài Jest đều không thấy.

**3. Một cổng chặn nhầm ở tầng rẻ sẽ âm thầm vô hiệu hoá mọi tầng đắt phía sau.** Cổng cấm hex
màu dùng `grep` thô không phân biệt chú thích với luật CSS; một dòng **chú thích** chứa
`#a34d08` làm nó đỏ, và vì nó ở TẦNG MỘT nên `--e2e` không bao giờ chạy tới. Nhánh đóng 7 story
với DoD gạch 7 hổng suốt, trong khi mọi cổng khác báo xanh.
