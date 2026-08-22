---
title: Rubric Review — Architecture Spine QLMgmtIP
reviewer: rubric-walker
reviewed: 2026-08-21
target: ../ARCHITECTURE-SPINE.md
sources-checked:
  - ../../..//prds/prd-IT_QLMgmtIP-2026-08-19/prd.md
  - ../../../prds/prd-IT_QLMgmtIP-2026-08-19/addendum.md
  - F:/PMH/Project_QLTS/qlts (đối chiếu code thật)
  - npm registry (kiểm chứng version, 2026-08-21)
---

# Review Rubric — ARCHITECTURE-SPINE.md (QLMgmtIP)

## Verdict

**ĐẠT CÓ ĐIỀU KIỆN.** Spine chắc tay ở đúng tầm altitude: 12 AD fix trúng các điểm phân kỳ thật (ownership bảng, vault cô lập, transaction+outbox, một luồng duyệt, expiry đăng ký, auth 5 tường, copy-map QLTS), toàn bộ 7 version thư viện kiểm chứng khớp npm, và mọi khẳng định về code QLTS đều đúng với source thật. Nhưng có **một mâu thuẫn nội tại giữa AD-2 / AD-3 / AD-7 về đọc dữ liệu chéo module** — đúng loại phân kỳ mà spine tồn tại để chặn — cộng vài khoảng trống (pattern lịch sử bản ghi, ownership bảng danh mục) phải vá trước khi xuống epics/stories.

---

## Findings

### HIGH

**H1 — Mâu thuẫn AD-2 ↔ AD-3 ↔ AD-7 về đọc chéo module; đường composition cho FR-005/FR-027 không được quyết.**
- AD-3 nói: "Module khác **chỉ đọc**" (cho phép SELECT bảng module khác).
- AD-2 nói: "**cấm SELECT thẳng bảng module khác**; cần dữ liệu chéo → gọi service công khai của module kia qua DI" — nhưng đồng thời AD-2 "**không import ngang** trong cùng tầng nghiệp vụ". Gọi service của module ngang hàng qua DI **chính là** import ngang (NestJS phải import module đó). Hai vế của cùng một Rule tự phủ định nhau.
- AD-7 nói expiry engine "không import module nghiệp vụ" nhưng quét `(bảng, cột start/end)` do nghiệp vụ đăng ký — tức là engine **SELECT thẳng** bảng nghiệp vụ, việc AD-2 cấm.
- Hệ quả thực tế: FR-005 (trang thiết bị hiện IP + secret + license + sự cố + phiếu) và FR-027 (dashboard gộp expiry + incidents + break-glass) đòi dữ liệu chéo 4-5 module, trong khi graph phụ thuộc vẽ `devices` không → `ipam/software/vault` và `dashboard` chỉ → `auth/common/database`. Hai đơn vị build độc lập sẽ chọn hai đường khác nhau (composition ở frontend gọi nhiều API / SELECT thẳng / view SQL / DI ngang) — spine phải chốt MỘT đường (đề xuất: đọc chéo cho màn hình tổng hợp = composition phía web gọi API từng module; đọc chéo phía server = read-only SELECT có đăng ký, ghi vẫn độc quyền chủ bảng; vault mãi mãi ngoại lệ AD-4).
- Vị trí: AD-2, AD-3, AD-7, mermaid graph, FR-005/FR-027.

### MEDIUM

**M1 — Pattern "lịch sử bản ghi" không được quyết dù 3 FR đòi nó.** FR-007 (lịch sử sửa đổi từng hồ sơ), FR-014 (lịch sử các lần gia hạn), FR-018 (lịch sử IP vĩnh viễn). Có 2 đường hợp lệ: đọc ngược từ `audit_log`, hoặc bảng history append-only riêng (QLTS có sẵn pattern `allocation_history` + migration `*_append_only.sql`, addendum §1 đã trỏ tới cho IP). Spine im lặng → devices có thể chọn đường 1, ipam chọn đường 2. Đây là điểm phân kỳ thật, đáng một AD hoặc một dòng convention.

**M2 — AD-3 thiếu chủ ghi cho một loạt bảng chắc chắn tồn tại.** Danh mục FR-004 (`device_type`, `site`, `cabinet`) không có chủ; module `documents` (FR-034) ghi bảng gì — không có trong danh sách; `files` (bảng attachment), `expiry` (bảng đăng ký loại hạn / lịch sử gia hạn), `system_config` (config) cũng vắng. AD-3 tự tuyên bố "mỗi bảng một chủ ghi" nhưng bảng danh sách chỉ phủ 9/16 module — lỗ hổng ngay trong chính invariant.

**M3 — AD-2/AD-3/AD-4 không nêu cơ chế enforce; chỉ AD-9 có ("review chặn", default-401).** Spine lấy chính vòng import `assets-write→software-license→assets.service` của QLTS làm lý do cho AD-2 — vòng đó sinh ra dưới chế độ review-only y hệt. Cần một dòng: lint boundary (eslint-plugin-boundaries / dependency-cruiser) trong CI cho luật tầng + grep cấm tên bảng `secret` ngoài module vault. Không có máy chặn thì Prevents của AD-2/AD-4 chỉ là lời hứa.

**M4 — Vỏ vận hành còn 2 lỗ: điểm chấm dứt TLS và nghi thức restore.** Seed nói "prod HTTPS 443, wildcard *.pmh.com.vn" nhưng không nói service nào giữ cert/terminate TLS (nginx trong `web`? caddy riêng? api tự serve?) — 5 service compose không có chỗ nào được chỉ định, hai người build sẽ đặt khác nhau. NFR-02 đòi "restore drill định kỳ có biên bản" và "chìa giấy 2 phong bì 2 người giữ" — backup đã có trong Seed (pg_dump, NAS, 30+12 bản, không kèm master key: tốt) nhưng drill/chìa giấy không xuất hiện ở Seed/Deferred/Open — nên ghi vào Seed hoặc Open Questions để không rơi mất khi xuống stories.

### LOW

**L1 — FR-028 (export xlsx từ mọi bảng đang xem) không có convention.** Mỗi module sẽ tự chế endpoint export riêng shape riêng. Một dòng convention là đủ (vd: mọi list endpoint kèm `GET .../export?` cùng filter, dùng exporter chung mượn `asset-export.service` QLTS).

**L2 — Job "sinh kỳ phiếu nhóm A" (FR-029) chưa có chỗ đứng.** AD-7 chủ ý không cho expiry biết nghiệp vụ; sweep worker chỉ được nhắc qua AD-5/Seed. Nên nói rõ: mọi job định kỳ nghiệp vụ (sinh kỳ phiếu, digest) = registrar trong worker qua BullMQ (pattern `*-sweep.registrar` QLTS đã có).

**L3 — Căng kỹ thuật AD-5 × AD-9: audit ghi bởi interceptor nhưng phải commit chung transaction với nghiệp vụ.** Làm được (request-scoped tx qua AsyncLocalStorage hoặc interceptor mở tx bọc handler) nhưng không tầm thường — đáng một câu chỉ định cách QLTS đang làm hoặc cách bắt buộc, tránh mỗi dev một kiểu.

**L4 — Key rotation: AAD chứa `key_version` (ngụ ý sẽ xoay master key) nhưng thủ tục rotation không được quyết cũng không nằm trong Deferred.** Nên thêm một dòng Deferred có chủ đích để không thành khoảng trống câm.

**L5 — FR-035 (cảnh báo chuỗi giống secret trong Documents) không được nhắc.** Chấp nhận được vì là hành vi nội bộ module `documents`, nhưng nên hiện diện ít nhất ở mức "thuộc documents, mức nhắc nhở theo [ASSUMPTION] PRD".

---

## Kết quả theo từng mục checklist

**1. Fix đúng điểm phân kỳ + bỏ sót?** — Fix trúng: ownership (AD-3), vault (AD-4), tx+outbox (AD-5), một approvals (AD-6), expiry đăng ký (AD-7), auth (AD-8), audit/authz mặc định đóng (AD-9), migration (AD-10), config (AD-11), copy-map (AD-12). Bỏ sót: đường đọc chéo/composition (H1), pattern lịch sử (M1), export (L1), job định kỳ nghiệp vụ (L2).

**2. Rule enforce được, Prevents chặn được?** — AD-9, AD-10, AD-11 enforce tốt (guard mặc định, runner checksum, docker secret). AD-1/5/6/8 enforce qua pattern + review, chấp nhận được. AD-2/AD-4 thiếu máy chặn (M3); AD-2 hiện **không thể** enforce vì Rule tự mâu thuẫn (H1). AD-3 Prevents đúng nhưng danh sách thiếu (M2).

**3. Deferred có giấu AD không?** — Không. 5 mục deferred đều bị chặn biên bởi AD/ownership/pattern QLTS hoặc có open item PRD tương ứng ("xóa hẳn" đã được AD-9 + FR-018 bảo hiểm dấu vết). Sạch.

**4. Version kiểm chứng?** — **ĐẠT 7/7.** Đối chiếu npm 2026-08-21: `@node-rs/argon2` 2.1.0 ✓ · `otplib` 13.4.1 ✓ · `csrf-csrf` 4.0.3 ✓ · `helmet` 8.3.0 ✓ · `exceljs` 4.4.0 ✓ · `bullmq` 6.1.2 ✓ · `@xyflow/react` 12.11.3 ✓.

**5. Ratify code QLTS?** — **ĐẠT.** Đối chiếu `F:\PMH\Project_QLTS\qlts\api\src`: tách read/write có thật (`assets-read.service.ts`/`assets-write.service.ts`); `database/migration-runner.ts` (advisory lock + checksum) ✓; `common/sql.ts`, `global-exception.filter.ts`, `crypto-secret.ts` ✓ (khẳng định "chỉ dùng cho SMTP" nhất quán — file là mã hóa phẳng); `web/src/ui` + `web/src/lib` ✓; migrations `0004_sessions.sql`/`0032_sessions_local_sa.sql` ✓; audit có `audited.decorator.ts` + `audit.interceptor.ts` + `0005_audit_append_only.sql` ✓; pattern `allocation_history` append-only ✓; `AuthedRequest` đúng là nằm trong `auth/identity.guard.ts` (file OIDC) như addendum tả ✓; booking/pool/chatbot/tickets tồn tại để bỏ ✓. Không phát hiện mâu thuẫn nào giữa spine và code sẽ copy.

**6. Coverage 36 FR + 6 NFR?** — Mọi FR đều có module nhận (F1→devices, F2→software+vault, F3→expiry, F4→ipam, F5→vault+approvals, F6→dashboard, F7→sheets+incidents+approvals, F8→documents); NFR-01/02→AD-8+AD-4, NFR-03→AD-9, NFR-04→Seed, NFR-05→Seed, NFR-06→convention i18n. Không FR nào mồ côi module, nhưng: FR-005/FR-027 kẹt trong mâu thuẫn H1; FR-007/014/018 kẹt M1; FR-004 kẹt M2; FR-028 (L1), FR-029-sinh-kỳ (L2), FR-035 (L5) mờ. NFR-02 phần drill/chìa giấy rơi khỏi spine (M4).

**7. Mọi chiều cấu trúc đã quyết/defer/open?** — Deployment (compose 5 service, non-root, không publish pg/redis), môi trường dev/prod, backup + retention, secret handling: **đã quyết trong Seed** — tốt hơn phần lớn spine cùng cỡ. Lỗ còn lại: TLS termination (M4), log rotation cho pino-stdout (chấp nhận docker mặc định — không tính lỗi), key rotation (L4), restore drill (M4). Open Questions (hostname/cert) đặt đúng chỗ, đúng chủ (user).

## Điều kiện để ĐẠT hẳn

1. Viết lại AD-2 để hết tự mâu thuẫn và chốt một đường composition cho FR-005/FR-027; hợp thức hóa ngoại lệ đọc của AD-7 (H1).
2. Thêm AD/convention "lịch sử bản ghi = bảng append-only theo pattern allocation_history" hoặc "= đọc từ audit_log" — chọn một (M1).
3. Bổ sung ownership các bảng thiếu vào AD-3 (M2).
4. Một dòng cơ chế enforce cho luật tầng + luật secret (M3); một dòng TLS termination + đưa restore drill vào Seed/Open (M4).
