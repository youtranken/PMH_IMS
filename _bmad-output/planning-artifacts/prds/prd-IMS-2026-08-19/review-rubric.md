# PRD Quality Review — QLMgmtIP (Hệ thống quản lý IT nội bộ PMH)

Ngày review: 2026-08-21 · Phạm vi: `prd.md` + `addendum.md` · Bối cảnh chấm: công cụ nội bộ, team IT 5 người, stakes internal, PRD capability-first có chủ đích (6–8 trang là đúng cỡ — không trừ điểm vì thiếu pricing/GTM/competitive).

## Overall verdict

PRD chắc tay và trung thực hiếm thấy ở cỡ này: thesis rõ (tri thức không rời đi theo người, bằng chứng sẵn cho audit, tra cứu <30s), NFR có số cụ thể thay vì boilerplate, rủi ro chấp nhận được nêu thẳng kèm lý do bác phương án thay thế (addendum §4), success metrics có counter-metrics thật. Sẵn sàng đi tiếp sang architecture. Rủi ro còn lại tập trung ở một lỗ hổng mô hình quyền (break-glass theo *nhóm thiết bị* không phủ secret của phần mềm/license — trong khi F2 lại yêu cầu Member break-glass license key) và một số hằng số chưa chốt ("N giây" ẩn secret, tần suất restore drill) sẽ làm engineer phải tự đoán khi viết story. Không có finding mức critical.

## 1. Decision-readiness — strong

Các quyết định được nêu là quyết định, không giấu thành "considerations": wildcard cert giữ nguyên *dù chuyên gia đề nghị SAN đơn* kèm lý do (addendum §4); trần bảo mật server-side encryption được thừa nhận thẳng ("server app bị chiếm = két lộ", addendum §3) thay vì né; E2E kiểu Bitwarden bị bác có lý do (mâu thuẫn break-glass). Danh sách rejected alternatives (addendum §4) là phần đáng giá nhất — người phản biện tìm thấy objection của mình đã được trả lời. Open items ít (3 mục) và đúng là mở thật.

### Findings
- **medium** NOTE FOR PM về cert wildcard thiếu owner/điều kiện đóng (§8 prd.md) — "cần xác nhận cover hostname nội bộ" nhưng không nói ai xác nhận, trước mốc nào (trước khi deploy? trước sprint 1?). *Fix:* thêm owner (SA/PM) + điều kiện "phải đóng trước khi dựng môi trường staging".
- **low** "Dual control" cho SA (§2) chỉ được hiện thực hóa là "2 account" (NFR-01) — không có cơ chế duyệt 2 người cho hành động nào. Nếu chỉ là 2 account + audit thì đừng gọi "dual control". *Fix:* đổi chữ thành "2 account SA + audit chéo" hoặc định nghĩa hành động nào cần 2 SA.

## 2. Substance over theater — strong

Không có persona theater (không có persona nào — đúng cho single-team internal tool). NFR không phải boilerplate: NFR-01 có con số lockout (5 lần/15 phút), idle/absolute session (30 phút/12h); NFR-02 chỉ định envelope AES-256-GCM, AAD, chống TOTP replay; NFR-05 có ngưỡng "<2 giây". Vision (§1) không thể swap sang PRD khác — nó nêu đúng 3 nỗi đau của chính team này (Excel/giấy/Zalo, license hết hạn không ai hay, không truy được IP cấp cho ai). Không có finding.

## 3. Strategic coherence — strong

Thesis xuyên suốt: "single source of truth + dấu vết + expiry không bất ngờ". 8 nhóm feature đều phục vụ thesis (kể cả F7 phiếu ISO — phục vụ vế "bằng chứng sẵn sàng khi audit"). Success metrics đo đúng thesis (<30s tra cứu, 100% credential vào vault sau 3 tháng, 0 hết hạn bất ngờ) chứ không đo activity; có counter-metrics thật (duyệt break-glass trung vị <15 phút — bảo mật không cản dập lửa; dữ liệu cập nhật trong 1 tuần — chống sổ thối). Phase sau (§7) gom đúng cụm phụ thuộc Wazuh, ranh giới sạch.

### Findings
- **low** SM "<30 giây tra cứu" chưa nói cách đo (§6) — với 5 user thì một drill định kỳ là đủ, nhưng nên ghi 1 dòng cách verify để metric không thành khẩu hiệu. *Fix:* thêm "(đo bằng drill tra cứu ngẫu nhiên hằng quý)".

## 4. Done-ness clarity — adequate

Đa số FR có hệ quả kiểm chứng được: FR-003 (validate + xem trước lỗi trước khi ghi), FR-013 (kèm ví dụ luật cụ thể), FR-017 (chặn cấp trùng tuyệt đối), FR-018 (lịch sử vĩnh viễn, xóa cũng để log), FR-022 (TOTP + grace 10 phút + hết hiệu lực phải gõ lại), FR-026 (phủ định tuyệt đối — test được). Nhưng vẫn còn vài hằng số và tiêu chí treo lơ lửng mà story creation sẽ vấp ngay.

### Findings
- **high** Mô hình break-glass FR-023/FR-024 keyed theo "member × nhóm thiết bị" không phủ secret của *phần mềm* (§3 F5, F2) — F2 quy định "license key… Member phải break-glass", nhưng flow break-glass là "chọn thiết bị" và whitelist quản trị theo nhóm thiết bị. Member cần license key của phần mềm không gắn thiết bị (SSL cert, domain, hợp đồng ISP có pass PPPoE) thì đi đường nào? Không tồn tại đường xin quyền. *Fix:* mở rộng FR-023/024 thành "member × nhóm đối tượng (thiết bị / phần mềm)" hoặc tuyên bố rõ Member không bao giờ truy cập secret phần mềm.
- **medium** "UI tự ẩn secret sau N giây" — N không xác định, xuất hiện 2 lần (FR-022, NFR-04) và không nằm trong `[ASSUMPTION]` hay Open items. Không testable. *Fix:* chốt số (vd 30s, cấu hình được) hoặc thêm `[ASSUMPTION]` vào §8.
- **medium** NFR-02 "restore drill định kỳ có biên bản" — "định kỳ" không có tần suất, không đo được, trong khi addendum §3 xếp "mất chìa" là top-risk được đóng chính bằng drill này. *Fix:* chốt tần suất (vd 6 tháng/lần).
- **low** FR-027 "3 phút đọc xong" là khát vọng thiết kế, không phải tiêu chí nghiệm thu; FR-035 "chuỗi giống mật khẩu" chưa có tiêu chí phát hiện (entropy? pattern?) — chấp nhận được ở mức nhắc-nhở nhưng nên ghi chú heuristic sẽ chốt lúc design.

## 5. Scope honesty — strong

Ngoài-scope nêu tường minh ngay §2 (email account, PC/laptop, booking, phiếu 0201/0211/0212, ký điện tử). Phase sau (§7) tách bạch, có cả backlog chưa xếp lịch — không hứa lẫn. **Kiểm tra phase-sau lẫn vào FR v1: sạch** — FR-006 port map dạng *bảng* là v1, "render port lên canvas" nằm đúng ở §7; FR-016 trạng thái IP "v1 đặt tay" tuyên bố rõ, scan tự động ở phase sau. 2 `[ASSUMPTION]` inline đều được index ở §8 và ngược lại (roundtrip đủ). Mật độ open items thấp (3 mục) — đúng với PRD đã qua 3 vòng thẩm định.

### Findings
- **low** Hai backlog không đồng bộ: addendum §3 có "nhắc đổi pass thiết bị sau break-glass (bài học CyberArk)" đánh dấu backlog, nhưng backlog §7 prd.md không có mục này. Downstream chỉ đọc prd.md sẽ mất nó. *Fix:* thêm 1 dòng vào backlog §7.

## 6. Downstream usability — adequate

FR/NFR ID liên tục, duy nhất, không nhảy số (FR-001→035, NFR-01→06). Addendum là tài sản lớn cho bmad-architecture: bản đồ tái sử dụng QLTS ở mức file/module, thư viện đã chọn kèm tham số, cảnh báo cụ thể (god node AuthedRequest 86 cạnh, crypto-secret.ts cũ không dùng cho vault). Không có Glossary nhưng thuật ngữ dùng khá nhất quán; với chain PRD→architecture→build nội bộ, thiếu Glossary chấp nhận được.

### Findings
- **medium** Yêu cầu vault cho license key ở F2 là bullet *không có mã FR* (§3 F2, dòng cuối) — một yêu cầu thật (kéo theo TOTP + break-glass) nhưng không trace được vào story. *Fix:* đánh mã (FR-011b hoặc FR-036) hoặc gộp tường minh vào FR-021.
- **medium** Mâu thuẫn PRD ↔ addendum về AAD: NFR-02 ghi `record_id + key_version`, addendum §2 ghi `record_id + key_version + table`. Nhỏ nhưng đúng chỗ hiểm (crypto spec) — hai người đọc hai file sẽ implement khác nhau. *Fix:* chốt một bản (bản addendum có `+ table` an toàn hơn, chống swap-record giữa bảng), sửa bản kia theo.
- **medium** Mâu thuẫn nội bộ NFR-01: "TOTP bắt buộc toàn bộ user" nhưng ngay sau đó "SA/Admin có toggle per member". Bắt buộc mà tắt được per member thì không phải bắt buộc. *Fix:* viết lại thành "TOTP mặc định bật cho mọi user; SA/Admin có thể tạm miễn per member (có audit)" nếu đó là ý định, hoặc bỏ toggle.
- **low** Nguồn phiếu ISO trỏ đường dẫn máy cá nhân `C:\Users\leminh\Documents\SP-IT02.7z` (addendum §5) — FR-029 yêu cầu tái tạo "y hệt" nên file mẫu là dependency cứng; đường dẫn này chết khi đổi máy. *Fix:* copy bộ mẫu vào repo/planning-artifacts.
- **low** Drift thuật ngữ nhẹ: "secret" / "credential" / "pass" dùng thay nhau qua §1, §2, F5, NFR — không gây hiểu sai nhưng nếu thêm Glossary 5 dòng thì chốt luôn.

## 7. Shape fit — strong

Đúng shape cho internal tool single-team: capability-spec làm xương sống, chỉ 2 UJ tối giản có chủ đích và cả 2 đều earn chỗ đứng — UJ-1 (member trực sự cố) xâu chuỗi được F1+F5+F7 thành một luồng thật, UJ-2 (sếp sáng thứ Hai) chứng minh F6. SM vận hành thay vì user-facing — đúng khuyến nghị rubric cho shape này. Không over-formalized, không under-formalized. Brownfield-adjacent (tái sử dụng QLTS) được xử lý đúng chỗ: chi tiết nằm ở addendum, không nhiễm vào PRD. Không có finding.

## Mechanical notes

- **ID continuity:** FR-001→FR-035 liên tục, không trùng, không gap. NFR-01→NFR-06 ổn. UJ-1, UJ-2 ổn. Ngoại lệ duy nhất: bullet vault license key ở F2 không có mã (đã nêu finding §6).
- **Assumptions roundtrip:** đủ 2 chiều — `[ASSUMPTION]` 24h (FR-023) và mức-nhắc-nhở (FR-035) đều có mặt ở §8; §8 không có entry mồ côi.
- **Cross-refs:** FR-005 tham chiếu IP/secret/license/phiếu — đều tồn tại ở F4/F5/F2/F7. FR-032 "RCA 0207 cùng mã" khớp FR-030. Addendum tham chiếu FR-009 chính xác.
- **Glossary:** không có (chấp nhận được, xem §6).
- **Frontmatter:** prd.md `updated: 2026-08-21` nhất quán với addendum `created: 2026-08-21`. Status vẫn `draft` — nếu review này pass thì nên nâng trạng thái.

## Tổng kết findings theo mức

| Mức | Số lượng | Tóm tắt |
|---|---|---|
| critical | 0 | — |
| high | 1 | Break-glass theo nhóm thiết bị không phủ secret phần mềm/license |
| medium | 6 | N giây ẩn secret chưa chốt · tần suất restore drill · bullet F2 không mã FR · AAD lệch PRD↔addendum · TOTP "bắt buộc" vs toggle · NOTE cert thiếu owner |
| low | 6 | dual control chỉ là 2 account · cách đo SM 30s · backlog lệch 2 file · đường dẫn ISO máy cá nhân · drift secret/credential · FR-027/FR-035 tiêu chí mềm |
