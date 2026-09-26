## graphify

Repo có knowledge graph ở `graphify-out/` (god nodes, community, quan hệ xuyên file).

- Câu hỏi về codebase: chạy `graphify query "<câu hỏi>"` trước. Dùng `graphify path "<A>" "<B>"`
  cho quan hệ và `graphify explain "<khái niệm>"` cho một khái niệm. Kết quả gọn hơn nhiều so với
  `GRAPH_REPORT.md` hay grep.
- Có `graphify-out/wiki/index.md` thì dùng nó để định hướng rộng.
- Chỉ đọc `GRAPH_REPORT.md` khi rà kiến trúc tổng thể, hoặc khi query/path/explain không đủ.
- Sửa code xong: `graphify update .` (chỉ AST, không tốn API).

---

## Dự án IMS — bản đồ tài liệu

IMS = Quản lý hệ thống IT của PMH. `master` nằm trên GitHub, và GitHub Actions là cổng chặn merge.
Trạng thái từng epic/story: đọc `sprint-status.yaml`, **không ghi số liệu trạng thái vào file này**
(số viết tay sẽ trôi và thành sai).

| Cần gì | Đọc ở đâu |
| --- | --- |
| Yêu cầu (FR/NFR) | `_bmad-output/planning-artifacts/prds/prd-IMS-2026-08-19/prd.md` + `addendum.md` |
| Luật kiến trúc AD-1..AD-16 | `_bmad-output/planning-artifacts/architecture/architecture-IMS-2026-08-21/ARCHITECTURE-SPINE.md` |
| Epic + story + AC | `_bmad-output/planning-artifacts/epics.md` |
| Trạng thái story | `_bmad-output/implementation-artifacts/sprint-status.yaml` |
| **Quyết định nghiệp vụ đã chốt** | `docs/QUYET-DINH.md` — thắng `epics.md` khi hai bên lệch nhau |
| Việc còn lại trước/sau go-live | `docs/GO-LIVE-CHECKLIST.md` |
| Deploy / sao lưu / khôi phục | `docs/RUNBOOK-4.3-dong-dot-1.md` |
| Mỗi epic để lại gì | `docs/EPIC-MAP.md` |
| Thiết kế màn hình | `_bmad-output/planning-artifacts/design-ims/` |

ARCHITECTURE-SPINE.md là luật, không phải gợi ý. Mọi story có ghi dữ liệu phải theo AD-3 (một
bảng một chủ), AD-5 (transaction + audit + outbox) và AD-9 (`@Audited` + `@Roles`).

Đổi một quyết định nghiệp vụ: sửa `docs/QUYET-DINH.md` trước (ghi ngày + lý do), rồi mới sửa code.

## Màu sắc & design token

Hệ màu "Sunset Grove" chỉ định nghĩa ở **một chỗ**: `web/src/css/tokens.css`.

- Component **không** viết hex/rgb trực tiếp, chỉ dùng `var(--primary)`, `var(--ink)`,
  `var(--danger)`… Đổi màu toàn hệ thống = sửa duy nhất `tokens.css`.
- `ops/gate-hex.sh` chỉ chặn **hex**. `rgb()/rgba()` còn nợ và chưa có cổng (FE-08 trong
  checklist), nên đừng thêm chỗ mới dựa vào việc cổng không kêu.
- Mỗi token light phải có cặp dark trong `html[data-theme='dark']`. **Không phải `.dark`**: selector
  đó không tồn tại trong repo, viết theo nó sẽ ra CSS hợp lệ mà không bao giờ chạy.
- Không tạo style riêng cho màn mới (UX-DR1): dùng lại `web/src/ui` và shell.
- Màn ĐỌC chạy được ở 390px (UX-DR2). Màn nhập phức tạp (import, form phiếu, grid tick) chỉ cần
  desktop.

## Dùng chung — luật AD-15

Trước khi viết **bất kỳ** component / hook / service nào: mở `docs/SHARED-REGISTRY.md` xem đã có chưa.

- Dùng ở ≥2 màn hoặc ≥2 module = tài sản dùng chung → `web/src/ui` (UI) hoặc `src/common` + module
  nền (API). Không để trong `features/`.
- Cần khác đi thì thêm prop/tham số/provider vào bản dùng chung. **Cấm copy ra bản riêng.**
- Cấm tuyệt đối:
  - `window.confirm` / `window.alert`;
  - dialog tự dựng trong `features/`;
  - hex màu ngoài `tokens.css`;
  - tự viết phân trang, export xlsx hay tính trạng thái hạn.
- Sinh ra thứ dùng chung mới thì khai vào `SHARED-REGISTRY.md` ngay trong story đó: tên, đường dẫn,
  dùng ở đâu, khi nào KHÔNG dùng.

## Viết chú thích

Chú thích trong repo này từng sai so với code nhiều lần. Vì vậy:

- **Chỉ viết chú thích trả lời "VÌ SAO"**: vì sao code như thế này, ràng buộc nào không được phá.
  Mã luật (AD-x, FR-x, NFR-x, SEC-x) thì giữ, vì tra được trong tài liệu.
- **Không viết lịch sử** vào code: ngày tháng, "trước ngày X nó…", "rà soát #N", "Story N.M",
  "ai sửa". Lịch sử để trong commit message, hoặc `docs/EPIC-MAP.md` nếu cần giữ lâu.
- Sửa code thì sửa luôn chú thích bên cạnh. Chú thích sai nguy hiểm hơn không có chú thích.
- **Không tin chú thích khi chưa đối chiếu code**, kể cả chú thích do chính mình viết.
- Dọn chú thích cũ: mỗi module một commit, sau đó kiểm `api/dist/*.js` phải giống hệt trước khi
  dọn (build bật `removeComments`). **Không đụng file migration** (xem mục Migration).

## Cách code: TDD → DoD

**TDD bắt buộc cho mọi logic nghiệp vụ.** Thứ tự không đảo:

1. Đọc AC trong `epics.md` (và `QUYET-DINH.md`) → viết test trước, test phải **đỏ**.
2. Viết code tối thiểu cho xanh.
3. Refactor khi đã xanh.

Các tầng test:

- **Unit api:** Jest (`api/src/**/*.spec.ts`). **Unit web:** Vitest (`web/src/**/*.test.tsx`). Logic
  thuần (tính hạn, parse Excel, envelope crypto, lockout) dùng test bảng dữ liệu, không test qua HTTP.
- **Integration chạm DB thật:** `api/test/*.spec.ts`, chạy bằng `npm --prefix api run test:db`.
  - Mỗi file tự tạo rồi xoá một DATABASE trắng riêng; migration thật chạy vào đó.
  - Cần Postgres/Redis/Mailpit của compose mở cổng loopback:
    `docker compose -f docker-compose.yml -f docker-compose.override.e2e.yml --profile dev up -d postgres redis mailpit`.
  - Đây là chỗ kiểm migration trên DB trắng (DoD gạch 5), ranh giới transaction, race condition,
    khử job đúp của BullMQ và SMTP thật. GitHub Actions KHÔNG chạy tầng này.
  - **Cấm mock drizzle.** Cần DB thì viết bài ở đây, đừng dựng `Pool` giả.
- **Đừng tin một bài kiểm chỉ vì nó xanh:** gieo một đột biến vào code rồi xem nó có đỏ không.
- **Lõi bảo mật** (Argon2, TOTP chống replay, envelope AES-GCM + `key_version`, CSRF, lockout, token
  phiên): không có test thì không được merge.

**Cổng kiểm kiểu của web là `npm run build`, KHÔNG phải `npx tsc --noEmit`.** `web/tsconfig.json`
chỉ có references (`"files": []`), nên `tsc --noEmit` ở đó xanh mà không kiểm file nào.

`tsconfig.app.json` **không bật `strict`**, nên TS không thu hẹp được union phân biệt bằng cờ boolean
(`if (!r.ok) r.reason` báo lỗi dù logic đúng). Hàm thuần bên web trả về MỘT hình dạng
(`{ value, reason }`), không dùng union `ok: true|false`.

## Kiểm theo 3 tầng — chạy đúng mức, không chạy thừa

E2E đầy đủ tốn khoảng 30 phút và nhiều RAM. Không chạy nó sau mỗi lần sửa nhỏ.

| Khi nào | Chạy gì | Thời gian |
| --- | --- | --- |
| **Mỗi lần sửa** | Unit + `test:db` của phần bị chạm. Trước khi commit: `bash ops/ci-local.sh` (lint, depcruise, unit, DB, build) | 1–4 phút |
| **Xong một mục / một story** | Chỉ dựng lại service bị đổi, rồi chỉ chạy spec E2E của mảng đó (xem bên dưới) | 3–5 phút |
| **Trước khi merge nhánh vào `master`, trước release, khi đóng epic** | `bash ops/ci-local.sh --e2e`: E2E đầy đủ, **một lần** | ~30 phút |

Tầng giữa:

```bash
docker compose -f docker-compose.yml -f docker-compose.override.e2e.yml --profile dev \
  up -d --build --wait api worker          # sửa web thì thêm: web
cd e2e && npx playwright test tests/<mảng>*.spec.ts --reporter=line
```

- Tầng giữa **bắt buộc dựng lại image**. Không dựng lại thì test chạy trên image cũ và báo xanh cho
  code chưa hề được nạp.
- Chạy lẻ spec mà thấy cảnh báo `login.rate_limit_per_ip đang là 500`, thì trả lại trên DB dev:
  `UPDATE system_config SET value = '20' WHERE key = 'login.rate_limit_per_ip';`
- `--e2e-fast` (~24 phút, bỏ các bài `@slow`) dùng khi muốn soát rộng giữa chừng. Nó không thay
  được `--e2e` ở tầng cuối.
- GitHub Actions chỉ chạy lint · depcruise · unit · build. **E2E và `test:db` không có ai ép ngoài
  tầng cuối ở trên.** GitHub xanh không có nghĩa là DoD gạch 7 đã đạt.

## Luật viết E2E

Playwright (`e2e/`), chạy trên compose thật, không mock API.

- Mỗi story có ít nhất 1 kịch bản đường-hạnh-phúc + 1 đường-hỏng. Lỗ bảo mật đã vá thì có một bài
  **dựng lại đúng đòn tấn công** (xem `security.spec.ts`).
- Màn ĐỌC có assertion ở viewport **390px** ngoài desktop. Màn có màu trạng thái thì test cả light
  lẫn dark.
- Không dùng `sleep`; chỉ `expect(...).toBeVisible()` / `waitForResponse`. Selector ưu tiên
  `getByRole`/`getByLabel`, cấm CSS class selector.
- Email dev đọc qua Mailpit API `http://localhost:8025/api/v1/messages`, không đọc log.
- **Mọi hàng bài kiểm tạo ra phải mang chữ `E2E` trong tên** (`device.code`, `software.code`,
  `subnet.name`, `isp_line.code`, `site.code`…; tài khoản là `e2e-tao-moi-…@`).
  - Đó là thứ DUY NHẤT `api/scripts/reset-e2e.mjs` nhìn vào để dọn.
  - Đặt sai tên thì rác tồn lại và làm đỏ một bài khác sau vài ngày.
  - `e2e/global-teardown.ts` đỏ ngay nếu còn hàng sống sót sau lượt dọn.

## Migration & DB

- Đánh số 4 chữ số, **chỉ tiến**, chạy sạch trên DB trắng (AD-10).
- **Không bao giờ sửa file migration đã có, kể cả chú thích.** Bộ chạy kiểm checksum trên cả file,
  nên đổi một ký tự là API từ chối khởi động. Muốn đổi schema thì thêm file mới.
- `api/src/migrations/*.sql` được git giữ nguyên từng byte (`-text` trong `.gitattributes`). Đừng
  đổi thuộc tính đó.
- Sau go-live, index trên bảng đã có dữ liệu phải dùng `CREATE INDEX CONCURRENTLY` trong file có
  dòng đầu `-- ims:no-transaction`.
- `ALTER DEFAULT PRIVILEGES` của 0048 cấp sẵn SELECT/INSERT/UPDATE/DELETE cho `ims_app` trên **mọi
  bảng mới**. Bảng chỉ-thêm (nhật ký, lịch sử) phải tự `REVOKE UPDATE, DELETE, TRUNCATE` ngay trong
  file tạo nó, và thêm bảng đó vào `api/test/app-role-privileges.spec.ts`.
- Ứng dụng chạy bằng role hẹp `ims_app`; migration chạy bằng role chủ sở hữu. Đừng gộp lại.

## Git & nhánh

- Không commit thẳng `master`. Mỗi cụm việc một nhánh (ví dụ `golive/g0a-bao-mat`), chạy tầng cuối
  rồi mới merge.
- Mỗi mục một commit. Commit message ghi mã mục (SEC-01, DOM-02…) và cách đã kiểm.
- **Bẫy CRLF:** một số file dùng CRLF. `sed -i` và Python text-mode đổi cả file sang LF, làm diff
  phình ra toàn file. Sửa bằng Edit, hoặc kiểm `git diff --numstat` sau mỗi lần sửa bằng script.

## Production (Ubuntu + Docker)

- Máy dev (Windows) và máy prod (Ubuntu) khác nhau. Hướng dẫn vận hành viết cho Ubuntu + `docker compose`.
- **Không bao giờ chạy trên máy prod:** `ops/ci-local.sh`, `ops/seed-demo.sql`, `ops/unseed-demo.sql`,
  `api/scripts/reset-e2e.mjs`, hay file `docker-compose.override.e2e.yml`.
- Bí mật (master key, pepper, SMTP password) chỉ nằm ở `secrets/`, chủ sở hữu uid 1000, chmod 600.
  Không bao giờ đi qua chat, email hay git.
- **Không xoá dòng chìa cũ trong `secrets/master_key`** khi chưa chạy rewrap báo còn 0 bản ghi
  (`QUYET-DINH.md` Q-07). Xoá nhầm = mất mọi secret và mọi TOTP.
- Prod dùng SMTP thật (Google Workspace). `mailpit` chỉ dành cho dev.

## Definition of Done — story chỉ `done` khi đủ 8 gạch

1. Mọi AC trong `epics.md` (và quyết định liên quan trong `QUYET-DINH.md`) có test, tất cả xanh.
2. Không vi phạm AD-1..AD-16; `dependency-cruiser` + eslint xanh.
3. Endpoint ghi có `@Audited` + `@Roles` + transaction `tx` tường minh (AD-5, AD-9).
4. Thứ dùng chung mới đã khai vào `docs/SHARED-REGISTRY.md` (AD-15).
5. Migration đúng mục "Migration & DB" ở trên.
6. UI tiếng Việt qua `lib/i18n`, không chuỗi cứng; màn đọc pass 390px.
7. E2E của mảng xanh ở tầng giữa; E2E đầy đủ xanh trước khi merge `master`.
8. Không hardcode tham số nghiệp vụ, đưa vào `system_config` (AD-11).

## Kết thúc epic — chạy đủ, đúng thứ tự

```bash
bash ops/ci-local.sh --e2e                 # 1. toàn bộ cổng + E2E đầy đủ
/code-review high                          # 2. soi toàn bộ thay đổi của epic, sửa hết finding
graphify update . && graphify cluster-only .   # 3. cập nhật bản đồ
graphify label . --missing-only            #    đặt tên community mới (cần API key)
```

Sau đó:

- `graphify god-nodes --top 15`: hub mới phải là public api (`*.api.ts`). Nếu một file nội bộ thành
  hub thì nghi vi phạm AD-2.
- Thêm mục **"Epic N đã đóng góp gì"** vào `docs/EPIC-MAP.md`: bảng mới + chủ sở hữu (AD-3), hợp
  đồng epic sau dùng, nợ kỹ thuật, bẫy đã gặp. **Không** ghi vào `GRAPH_REPORT.md`, vì file đó bị
  sinh lại mỗi lần update.
- Chỉ đổi epic sang `done` trong `sprint-status.yaml` sau khi đủ cả ba bước trên.
- Epic sau bắt đầu bằng `graphify query "<câu hỏi>"` trên bản đồ vừa cập nhật.
