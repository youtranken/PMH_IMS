## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).

---

## Dự án IMS — bản đồ tài liệu

Đây là repo IMS (Quản lý hệ thống IT — PMH). Giai đoạn hiện tại: kế hoạch xong, code chưa khởi tạo.

| Cần gì | Đọc ở đâu |
| --- | --- |
| Yêu cầu (FR/NFR) | `_bmad-output/planning-artifacts/prds/prd-IMS-2026-08-19/prd.md` + `addendum.md` |
| Luật kiến trúc AD-1..AD-14 | `_bmad-output/planning-artifacts/architecture/architecture-IMS-2026-08-21/ARCHITECTURE-SPINE.md` |
| Epic 1..9 + story + AC | `_bmad-output/planning-artifacts/epics.md` |
| Trạng thái story | `_bmad-output/implementation-artifacts/sprint-status.yaml` |
| Thiết kế màn hình (13 màn HTML) | `_bmad-output/planning-artifacts/design-ims/` |
| Code nền để copy sang (AD-12) | `F:/PMH/Project_QLTS/qlts` |

ARCHITECTURE-SPINE.md là luật, không phải gợi ý. Mọi story ghi phải theo AD-3 (một bảng một chủ), AD-5 (transaction + audit + outbox), AD-9 (`@Audited` + `@Roles`).

## Màu sắc & design token

Hệ màu = "Sunset Grove", định nghĩa **một chỗ duy nhất** (`web/src/css/tokens.css` copy từ QLTS; bản mockup ở `design-ims/_head.html`).

- Component **không được** viết hex/rgb trực tiếp — chỉ dùng `var(--primary)`, `var(--ink)`, `var(--danger)`… Đổi màu toàn hệ thống về sau = sửa duy nhất `tokens.css`.
- Mỗi token light phải có cặp dark trong `.dark`. Thêm token mới thì thêm cả hai.
- Không tạo style riêng cho màn mới (UX-DR1): dùng lại `web/ui` + shell (sidebar + command palette).
- Màn ĐỌC phải chạy được ở viewport 390px (UX-DR2); màn nhập phức tạp (import, form phiếu, grid tick) desktop-only.

## Dùng chung — luật AD-15

Trước khi viết **bất kỳ** component / hook / service nào: mở `docs/SHARED-REGISTRY.md` xem đã có chưa.

- Thứ dùng ở ≥2 màn hoặc ≥2 module = tài sản dùng chung → `web/src/ui` (UI) hoặc `src/common` + module nền (API). Không để trong `features/`.
- Cần khác đi thì thêm prop/tham số/provider vào bản dùng chung — **cấm copy ra bản riêng**.
- Cấm tuyệt đối: `window.confirm` / `window.alert`, dialog tự dựng trong `features/`, hex màu ngoài `tokens.css`, tự viết phân trang / export xlsx / tính trạng thái hạn.
- Sinh ra thứ dùng chung mới → khai vào `docs/SHARED-REGISTRY.md` ngay trong story đó (tên · đường dẫn · dùng ở đâu · khi nào KHÔNG dùng).
- Bộ nền tảng ra đời ở **Story 1.5**, xem sống ở `/dev/components`.

## Cách code: TDD → DoD → E2E

**TDD bắt buộc cho mọi logic nghiệp vụ.** Thứ tự không đảo:

1. Đọc AC của story trong `epics.md` → dịch thành test trước, test phải **đỏ**.
2. Viết code tối thiểu cho xanh. 3. Refactor khi đã xanh.
- Unit/integration: **Vitest** (`api/test`, `web/src/**/*.test.tsx`). Logic thuần (tính hạn, parse Excel, envelope crypto, lockout) phải có test bảng dữ liệu (table-driven), không test qua HTTP.
- Integration chạm DB: dùng Postgres thật trong docker (compose profile `test`), không mock drizzle.
- Lõi bảo mật (Argon2, TOTP chống replay, envelope AES-GCM + xoay `key_version`, CSRF, lockout) — **không có test thì không được merge**.

**E2E: Playwright** (`e2e/`), chạy trên compose thật, không mock API.
- Mỗi story có ít nhất 1 kịch bản đường-hạnh-phúc + 1 đường-hỏng.
- Màn ĐỌC phải có assertion ở viewport **390px** (UX-DR2) ngoài desktop.
- Test luôn cả light + dark khi màn có màu trạng thái.
- Không dùng `sleep`; chỉ `expect(...).toBeVisible()` / `waitForResponse`. Selector ưu tiên `getByRole`/`getByLabel`, cấm CSS class selector.
- Email dev bắt qua **Mailpit** (API `http://mailpit:8025/api/v1/messages`), không đọc log.

**Definition of Done — story chỉ `done` khi đủ 8 gạch:**

1. Mọi AC trong `epics.md` có test tương ứng, tất cả xanh.
2. Không vi phạm AD-1..AD-15; `dependency-cruiser` + eslint xanh.
3. Endpoint ghi có `@Audited` + `@Roles` + transaction `tx` tường minh (AD-5, AD-9).
4. Thứ dùng chung mới đã khai vào `docs/SHARED-REGISTRY.md` (AD-15).
5. Migration đánh số 4 chữ số, chỉ tiến, chạy sạch trên DB trắng (AD-10).
6. UI tiếng Việt qua `lib/i18n`, không chuỗi cứng; màn đọc pass 390px.
7. Có E2E Playwright xanh trên `docker compose up`.
8. Không hardcode tham số nghiệp vụ — vào `system_config` (AD-11).

**Kết thúc mỗi epic — chạy đủ 3 bước, đúng thứ tự:**

```bash
npm run test && npm run test:e2e     # 1. toàn bộ test xanh
/code-review high                     # 2. tự soi lại epic vừa xong, sửa hết finding
graphify update . && graphify cluster-only .   # 3. cập nhật bản đồ (mục dưới)
```

Code review là bắt buộc, không phải tùy chọn: chạy `/code-review high` trên toàn bộ thay đổi của epic, sửa hết finding **trước khi** đóng epic trong `sprint-status.yaml`.

## Kết thúc epic → cập nhật graphify (bắt buộc)

Mỗi khi một epic chuyển sang `done` trong `sprint-status.yaml`, phải làm tuần tự trước khi mở epic kế:

```bash
graphify update .          # re-extract AST, không tốn API
graphify cluster-only .    # gom community lại + sinh lại GRAPH_REPORT.md
graphify label . --missing-only   # đặt tên community mới (cần API key)
```

Sau đó kiểm nhanh và ghi lại:

- `graphify god-nodes --top 15` — hub mới xuất hiện có đúng là public api (`*.api.ts`) không; nếu một file nội bộ thành hub → nghi phạm vi phạm AD-2.
- Thêm một mục **"Epic N đã đóng góp gì"** vào `docs/EPIC-MAP.md`: bảng mới + chủ sở hữu (AD-3), hợp đồng epic sau sẽ dùng, nợ kỹ thuật, bẫy đã gặp. (Ghi ở đây chứ KHÔNG ghi vào `GRAPH_REPORT.md` — file đó bị sinh lại mỗi lần `graphify update`, ghi tay vào sẽ mất.)
- Epic sau bắt đầu bằng `graphify query "<câu hỏi>"` trên bản đồ vừa cập nhật, không đọc mò source.

Lần đầu tiên (sau story 1.1, khi đã có code): chạy `/graphify` để build graph đầy đủ, kể từ đó mới dùng `update`.
