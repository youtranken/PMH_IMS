# _SPEC — bản xem trước "Trang chi tiết v2" (bố cục 2 cột)

Đây là **hợp đồng chung** cho mọi file `.html` trong thư mục này. Mỗi trang xem trước phải theo
đúng file này, không tự chế biến. Mục tiêu: chủ dự án mở bằng trình duyệt, duyệt bằng mắt, rồi
mới port vào `web/src`.

Phạm vi đợt này: **5 trang chi tiết thật** của IMS.

| File | Màn thật | Nguồn sự thật (ĐỌC TRƯỚC KHI VIẾT) |
| --- | --- | --- |
| `thiet-bi.html` | `/devices/:id` | `web/src/features/devices/device-detail.tsx` |
| `phan-mem.html` | `/software/:id` | `web/src/features/software/software-detail.tsx` |
| `duong-truyen.html` | `/isp-lines/:id` | `web/src/features/isp/isp-detail.tsx` |
| `tai-khoan-dich-vu.html` | `/service-accounts/:id` | `web/src/features/service-accounts/service-account-detail.tsx` |
| `dai-ip.html` | `/ip-addresses/:id` | `web/src/features/ipam/subnet-detail.tsx` |

---

## LUẬT 0 — CHỈ VẼ THỨ ĐANG CÓ THẬT

Đây là luật nghiêm nhất của đợt này, do chủ dự án đặt ra: *"dựa trên thông tin có chứ không
html tĩnh cái không có"*.

**Được phép:** xếp lại vị trí, đổi trọng số thị giác, gộp/tách khối, đổi khoảng cách, đổi cỡ chữ,
bỏ thứ trùng lặp.

**CẤM:**
- Bịa trường dữ liệu. Mỗi nhãn trên bản xem trước phải truy được về một trường trong
  `*-detail.tsx` hoặc `api/src/modules/<module>/*.api.ts`.
- Bịa nút / hành động. Nút nào không có trong `*-detail.tsx` thì không được vẽ.
- Bịa tab. Danh sách tab lấy đúng từ mảng `tabItems` / `<Tabs items={…}>` của màn đó, kể cả
  luật ẩn/hiện (ví dụ tab "Port map" chỉ có khi `hasPortMap`).
- Bịa biểu đồ, KPI, "hoạt động gần đây", "thống kê" — không màn nào có mấy thứ đó.
- Bịa tiếng Việt. Nhãn lấy nguyên văn từ `web/src/locales/vi.ts` (tra theo khóa `t("…")` trong
  file màn). Sai một chữ là lúc port lại phải dịch ngược.

**Dữ liệu mẫu** thì được bịa (mã máy, tên người, ngày tháng) — miễn là nó điền vào một trường
CÓ THẬT và trông như dữ liệu PMH thật (`SW-CORE-01`, `LST · T-1`, `nv.hoang@pmh.com.vn`).

Mỗi trang phải cho thấy **cả hai trạng thái dữ liệu**, vì đây là chỗ bản hiện tại hỏng nặng nhất:
- hồ sơ **khai đủ** (nhiều trường có giá trị), và
- hồ sơ **khai sơ sài** (đa số trường trống) — dựng thêm một khối demo nhỏ ở cuối trang, xem mục
  "Khối §B" bên dưới.

---

## 1. Vì sao làm lại — 8 lỗi bản hiện tại (bản xem trước phải sửa hết)

Đo trên stack thật 13/09/2026, ảnh chụp 1440px và 390px:

1. **Trọng số nút lộn ngược** — "Thanh lý" (đỏ đặc, không hoàn tác) nổi hơn "Sửa hồ sơ" (viền xám,
   việc chính). → nút chính `primary`, nút phá `danger-ghost` và tách khỏi cụm.
2. **Ô rỗng hiện hai lần** — lưới vẽ ô `Model: —` rồi ngay dưới lại có dòng "Chưa khai: Model…".
   → lưới CHỈ vẽ ô có giá trị; dòng "Chưa khai" là nơi duy nhất nói về ô trống.
3. **Dải chỉ số kéo giãn** — 2 chỉ số thì mỗi ô phình ra nửa màn hình. → bỏ dải ngang, đưa vào
   cột phải.
4. **Một cột dài trên màn 1440** — 70% chiều cao là nền trắng, dòng `Nhà cung cấp: Viettel` kéo
   dài 1160px. → bố cục 2 cột.
5. **Trùng giá trị trong cùng một ô** — `Vị trí: LST · T-1` với ghi chú `T-1`.
6. **Panel hai tiêu đề chồng nhau** — "LICENSE ĐANG CÀI" rồi "PHẦN MỀM ĐANG CÀI (1)".
7. **Badge đếm hiện số 0** trên tab.
8. **Thang cách/cỡ chữ cụt đầu trên** — `--space-10` chỉ 1.5rem (21px ở root 14px) và
   `--fs-2xl` cũng 1.5rem, nên không có nấc nào để tách KHU với KHU. Tiêu đề trang chi tiết
   (`--fs-xl` = 18.2px) còn NHỎ HƠN tiêu đề trang danh sách (`--fs-2xl` = 21px).

---

## 2. Bố cục 2 cột — luật chung của cả 5 trang

```
≥1200px                                   <1200px
┌────────────┬──────────────┐             ┌──────────────────┐
│ .dmain     │ .drail 320px │             │ .drail (lên TRÊN)│
│ tabs +     │ thẻ định danh│             ├──────────────────┤
│ nội dung   │ (sticky)     │             │ .dmain           │
└────────────┴──────────────┘             └──────────────────┘
```

- `.detail-2col { display: grid; grid-template-columns: minmax(0,1fr) 320px; gap: var(--space-12); }`
- Dưới 1200px: một cột, và **`.drail` nhảy lên trước** bằng `order` — trên điện thoại người ta
  cần trạng thái/vị trí ngay, không phải cuộn qua bảng license mới thấy.
- `.drail` dính: `position: sticky; top: var(--space-10)` (chỉ ở ≥1200px).

**Chia việc giữa hai cột — theo nghĩa, không theo độ dài:**

| Cột | Trả lời câu hỏi | Chứa |
| --- | --- | --- |
| `.drail` — thẻ định danh | "Cái này là gì, ở đâu, của ai, còn hạn không" | trạng thái, vị trí, người giữ/phụ trách, hạn, nhà cung cấp, ngày mốc |
| `.dmain` — nội dung | "Nó dính tới cái gì, và đã xảy ra chuyện gì" | thanh tab + thanh hạn + bảng quan hệ (license/IP/port/máy dùng) + giấy tờ + két + lịch sử |

Một trường chỉ được xuất hiện **một lần** trên toàn trang. Đã vào `.drail` thì KHÔNG lặp ở lưới
`.dmain` (đây chính là lỗi số 4 của bản cũ).

**Cụm nút** nằm ở hàng tiêu đề, bên phải, và chỉ ở đó:
```html
<div class="dactions">
  <button class="btn primary">Sửa hồ sơ</button>
  <span class="act-gap"></span>
  <button class="btn danger-ghost">Thanh lý</button>
</div>
```
`.act-gap` là khoảng trắng `var(--space-10)` — việc phá phải cách việc thường một quãng, để tay
không trượt vào.

---

## 3. Khung file — dán nguyên, không sửa

Mỗi trang là MỘT file `.html` tự chứa: không CDN, không font ngoài, không ảnh ngoài, không
framework. Mở bằng `file://` phải chạy đủ.

Thứ tự: `<style>` (mục 4) → `<body>` shell (mục 5) → nội dung → `<script>` (mục 6).

```html
<!doctype html>
<html lang="vi" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>IMS — Chi tiết <TÊN MÀN></title>
<style> /* mục 4 */ </style>
</head>
<body>
  <!-- mục 5 -->
</body>
</html>
```

---

## 4. Khối CSS — DÁN NGUYÊN VĂN vào mọi trang

Token lấy từ `web/src/css/tokens.css` (nguồn màu duy nhất, AD-15). **Không được thêm hex rời.**
Bốn token đánh dấu `/* MỚI v2 */` là thứ đợt này đề nghị thêm vào `tokens.css` lúc port.

```css
:root{
  --canvas:#f7f6f2; --surface:#ffffff; --surface-2:#f2f1ea;
  --ink:#1f231c; --ink-2:#5a615a; --ink-3:#5c635c;
  --border:#e9eae2; --border-2:#d8dbd0;
  --primary:#0e9f6e; --primary-ink:#0a7d54; --primary-soft:#e5f6ee;
  --warm:#f59e0b; --warm-ink:#ea580c; --warm-soft:#fef2df;
  --grad:linear-gradient(135deg,#0e9f6e,#f59e0b);
  --sidebar-bg:#16231b; --sidebar-ink:#8ea595; --sidebar-ink-2:#eaf3ee;
  --sidebar-active-bg:rgba(245,158,11,.16); --sidebar-active-ink:#ffe1b3;
  --sidebar-border:#24352a; --sidebar-label:#9fb0a5;
  --ok:#0f7a55; --ok-soft:#e4f4ee; --warn:#a34d08; --warn-soft:#fdf0e3;
  --danger:#c0392b; --danger-soft:#fdeceb; --muted:#5f665f; --muted-soft:#efeee7;
  --on-accent:#ffffff; --on-brand:#0b2018; --danger-strong:#a5271b;
  --border-ok:#bfe4d4; --border-warn:#f2d9b8; --border-danger:#f4cfcb;
  --ring:0 0 0 3px rgba(14,159,110,.22);
  --r-sm:8px; --r:10px; --r-lg:14px; --radius-pill:999px;
  --space-1:.25rem; --space-2:.4rem; --space-3:.5rem; --space-4:.6rem; --space-5:.75rem;
  --space-6:.85rem; --space-7:1rem; --space-8:1.1rem; --space-9:1.25rem; --space-10:1.5rem;
  --space-11:2.25rem;   /* MỚI v2 — tách khối trong một khu */
  --space-12:3rem;      /* MỚI v2 — tách KHU với KHU */
  --space-13:4.25rem;   /* MỚI v2 — tách tầng trang */
  --fs-2xs:.72rem; --fs-xs:.8rem; --fs-sm:.88rem; --fs-md:1rem; --fs-lg:1.1rem;
  --fs-xl:1.3rem; --fs-2xl:1.5rem;
  --fs-3xl:1.95rem;     /* MỚI v2 — mã hồ sơ ở đầu trang chi tiết */
  --fw-medium:500; --fw-semibold:600; --fw-bold:700;
  --shadow-sm:0 1px 2px rgba(16,24,40,.05);
  --shadow:0 1px 3px rgba(16,24,40,.08),0 1px 2px rgba(16,24,40,.05);
  --font:'Inter',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;
  --mono:ui-monospace,'Cascadia Code','SF Mono',Consolas,monospace;
  --ease:cubic-bezier(.4,0,.2,1);
}
html[data-theme='dark']{
  --canvas:#0f140f; --surface:#161d16; --surface-2:#1d261d;
  --ink:#e9ede7; --ink-2:#a7b0a5; --ink-3:#9aa39a;
  --border:#26312a; --border-2:#37453a;
  --primary:#34d399; --primary-ink:#6ee7b7; --primary-soft:#123024;
  --warm:#fbbf24; --warm-ink:#f59e0b; --warm-soft:#3a2c14;
  --grad:linear-gradient(135deg,#34d399,#fbbf24);
  --ok:#43c294; --ok-soft:#13312a; --warn:#e0a35a; --warn-soft:#3a2c18;
  --danger:#ef6f63; --danger-soft:#3a1f1d; --muted:#9aa59a; --muted-soft:#232d23;
  --on-accent:#0f140f; --on-brand:#0f140f; --danger-strong:#ef8f85;
  --border-ok:#1d4a3a; --border-warn:#4a3a1c; --border-danger:#4d2b27;
  --sidebar-bg:#0e140f; --sidebar-border:#1e2a22;
  --ring:0 0 0 3px rgba(52,211,153,.3);
  --shadow-sm:0 1px 2px rgba(0,0,0,.3);
  --shadow:0 1px 3px rgba(0,0,0,.4),0 1px 2px rgba(0,0,0,.3);
  color-scheme:dark;
}
*{margin:0;box-sizing:border-box}
html{font-size:14px}
body{min-height:100vh;overflow-x:hidden;font-family:var(--font);font-size:var(--fs-sm);
  line-height:1.5;color:var(--ink);background:var(--canvas);-webkit-font-smoothing:antialiased}
a{color:var(--primary-ink);text-decoration:none}
a:hover{text-decoration:underline}
.mono{font-family:var(--mono)}
.muted{color:var(--ink-3)}

/* --- Shell --------------------------------------------------------------- */
.shell{display:flex;min-height:100vh}
.sb{width:236px;flex:0 0 236px;background:var(--sidebar-bg);border-right:1px solid var(--sidebar-border);
  display:flex;flex-direction:column;position:sticky;top:0;height:100vh}
.sb-brand{display:flex;align-items:center;gap:var(--space-5);padding:var(--space-9) var(--space-9);
  color:var(--sidebar-ink-2);font-weight:var(--fw-bold);font-size:var(--fs-lg)}
.sb-logo{width:28px;height:28px;border-radius:var(--r-sm);background:var(--grad);display:grid;
  place-items:center;color:var(--on-brand);font-size:var(--fs-2xs);font-weight:var(--fw-bold)}
.sb-nav{flex:1;overflow-y:auto;padding:var(--space-3) var(--space-5)}
.sb-label{padding:var(--space-7) var(--space-4) var(--space-3);font-size:var(--fs-2xs);
  letter-spacing:.08em;text-transform:uppercase;color:var(--sidebar-label);font-weight:var(--fw-bold)}
.sb-item{display:flex;align-items:center;gap:var(--space-5);padding:var(--space-4) var(--space-5);
  border-radius:var(--r-sm);color:var(--sidebar-ink);font-size:var(--fs-sm);margin-bottom:2px}
.sb-item:hover{background:rgba(255,255,255,.05);color:var(--sidebar-ink-2);text-decoration:none}
.sb-item.active{background:var(--sidebar-active-bg);color:var(--sidebar-active-ink);font-weight:var(--fw-semibold)}
.sb-item svg{width:17px;height:17px;flex:0 0 17px}
.sb-foot{padding:var(--space-7);border-top:1px solid var(--sidebar-border);color:var(--sidebar-ink)}
.main{flex:1;min-width:0;display:flex;flex-direction:column}
.topbar{height:52px;flex:0 0 52px;display:flex;align-items:center;gap:var(--space-7);
  padding:0 var(--space-10);border-bottom:1px solid var(--border);background:var(--surface)}
.topbar .grow{flex:1;min-width:0;color:var(--ink-3);font-size:var(--fs-xs)}
.icon-btn{width:34px;height:34px;display:grid;place-items:center;border:1px solid var(--border-2);
  border-radius:var(--r-sm);background:var(--surface);color:var(--ink-2);cursor:pointer}
.icon-btn:hover{border-color:var(--primary);color:var(--primary-ink)}
.icon-btn svg{width:17px;height:17px}
.page{padding:var(--space-11) var(--space-10) var(--space-13);max-width:1560px;width:100%;margin-inline:auto}

/* --- Đầu trang ----------------------------------------------------------- */
.crumbs{display:flex;align-items:center;flex-wrap:wrap;gap:var(--space-2);font-size:var(--fs-xs);
  color:var(--ink-3);margin-bottom:var(--space-7)}
.crumb-back{display:inline-flex;align-items:center;gap:var(--space-1);padding:3px var(--space-5) 3px var(--space-4);
  border:1px solid var(--border-2);border-radius:var(--radius-pill);background:var(--surface);
  color:var(--ink);font-weight:var(--fw-semibold)}
.crumb-back:hover{border-color:var(--primary);color:var(--primary-ink);text-decoration:none}
.crumb-sep{opacity:.5;padding:0 var(--space-1)}
.dtitle-row{display:flex;align-items:flex-start;gap:var(--space-10);flex-wrap:wrap;
  padding-bottom:var(--space-10);border-bottom:1px solid var(--border);margin-bottom:var(--space-11)}
.dtitle-main{flex:1 1 22rem;min-width:0}
.dcode{display:flex;align-items:baseline;flex-wrap:wrap;gap:var(--space-5);font-family:var(--mono);
  font-size:var(--fs-3xl);font-weight:var(--fw-bold);letter-spacing:-.02em;line-height:1.15}
.dname{font-family:var(--font);font-size:var(--fs-lg);font-weight:var(--fw-medium);color:var(--ink-2)}
.dsub{display:flex;align-items:center;flex-wrap:wrap;gap:var(--space-3);margin-top:var(--space-4);
  font-size:var(--fs-xs);color:var(--ink-3)}
.dsub .dot{opacity:.45}
.dactions{display:flex;align-items:center;gap:var(--space-4);flex-wrap:wrap}
.act-gap{width:var(--space-10)}

/* --- Nút ----------------------------------------------------------------- */
.btn{display:inline-flex;align-items:center;gap:var(--space-3);padding:var(--space-4) var(--space-8);
  min-height:34px;border:1px solid var(--border-2);border-radius:var(--r-sm);background:var(--surface);
  color:var(--ink);font:inherit;font-weight:var(--fw-semibold);font-size:var(--fs-sm);cursor:pointer;
  transition:background .15s var(--ease),border-color .15s var(--ease)}
.btn:hover{background:var(--surface-2)}
.btn:focus-visible{outline:none;box-shadow:var(--ring)}
.btn.primary{background:var(--grad);border-color:transparent;color:var(--on-brand);
  box-shadow:0 8px 18px -10px var(--warm-ink)}
.btn.primary:hover{filter:brightness(1.04)}
.btn.danger-ghost{background:transparent;border-color:var(--border-danger);color:var(--danger-strong)}
.btn.danger-ghost:hover{background:var(--danger-soft)}
.btn.ghost{background:transparent;border-color:transparent;color:var(--ink-2)}
.btn.ghost:hover{background:var(--muted-soft);color:var(--ink)}
.btn.sm{min-height:28px;padding:var(--space-2) var(--space-5);font-size:var(--fs-xs)}
.btn svg{width:15px;height:15px}
.copy-btn{display:inline-grid;place-items:center;width:22px;height:22px;border:1px solid var(--border-2);
  border-radius:6px;background:var(--surface);color:var(--ink-3);cursor:pointer;vertical-align:-5px}
.copy-btn:hover{color:var(--primary-ink);border-color:var(--primary)}
.copy-btn svg{width:12px;height:12px}

/* --- Hai cột ------------------------------------------------------------- */
.detail-2col{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:var(--space-12);align-items:start}
.dmain{min-width:0}
.drail{min-width:0;position:sticky;top:var(--space-10);display:flex;flex-direction:column;gap:var(--space-9)}
.rail-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--r-lg);
  padding:var(--space-9) var(--space-9);box-shadow:var(--shadow-sm)}
.rail-h{font-size:var(--fs-2xs);font-weight:var(--fw-bold);letter-spacing:.07em;text-transform:uppercase;
  color:var(--ink-3);margin-bottom:var(--space-8)}
.rail-row{display:flex;flex-direction:column;gap:2px;padding:var(--space-5) 0;border-top:1px solid var(--border)}
.rail-row:first-of-type{border-top:none;padding-top:0}
.rail-k{font-size:var(--fs-2xs);font-weight:var(--fw-semibold);letter-spacing:.05em;
  text-transform:uppercase;color:var(--ink-3)}
.rail-v{font-size:var(--fs-md);font-weight:var(--fw-semibold);overflow-wrap:anywhere}
.rail-note{font-size:var(--fs-xs);color:var(--ink-3)}

/* --- Tab ----------------------------------------------------------------- */
.tabs{display:flex;gap:var(--space-1);border-bottom:1px solid var(--border);overflow-x:auto;
  scrollbar-width:none;margin-bottom:var(--space-11)}
.tabs::-webkit-scrollbar{display:none}
.tab{flex-shrink:0;white-space:nowrap;padding:var(--space-5) var(--space-9);border:none;
  border-bottom:2px solid transparent;background:none;color:var(--ink-3);font:inherit;
  font-weight:var(--fw-semibold);font-size:var(--fs-sm);cursor:pointer;margin-bottom:-1px}
.tab:hover:not(.active){color:var(--ink-2)}
.tab.active{color:var(--primary-ink);border-bottom-color:var(--primary)}
.tab-count{display:inline-block;min-width:18px;padding:0 5px;margin-left:var(--space-3);
  border-radius:var(--radius-pill);background:var(--muted-soft);color:var(--ink-3);
  font-size:var(--fs-2xs);font-weight:var(--fw-bold);text-align:center}
.tab.active .tab-count{background:var(--primary-soft);color:var(--primary-ink)}
.tabpanel{display:none}
.tabpanel.show{display:block}

/* --- Thẻ nội dung -------------------------------------------------------- */
.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--r-lg);
  padding:var(--space-9) var(--space-10);box-shadow:var(--shadow-sm);margin-bottom:var(--space-11)}
.card-h{display:flex;align-items:center;justify-content:space-between;gap:var(--space-7);
  margin-bottom:var(--space-9)}
.card-h h2{font-size:var(--fs-md);font-weight:var(--fw-semibold);letter-spacing:-.005em}
.card-h .sub{font-size:var(--fs-xs);color:var(--ink-3);font-weight:var(--fw-medium)}
.data-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:var(--space-8) var(--space-10)}
.data-item{min-width:0}
.data-item dt{font-size:var(--fs-2xs);font-weight:var(--fw-semibold);letter-spacing:.05em;
  text-transform:uppercase;color:var(--ink-3);margin-bottom:2px}
.data-item dd{font-size:var(--fs-md);font-weight:var(--fw-medium);overflow-wrap:anywhere}
.blank-fields{margin-top:var(--space-9);padding-top:var(--space-7);border-top:1px dashed var(--border-2);
  font-size:var(--fs-xs);color:var(--ink-3)}

/* --- Badge --------------------------------------------------------------- */
.badge{display:inline-flex;align-items:center;gap:var(--space-2);padding:2px var(--space-5);
  border-radius:var(--radius-pill);border:1px solid var(--border-2);background:var(--muted-soft);
  color:var(--ink-2);font-size:var(--fs-xs);font-weight:var(--fw-semibold);white-space:nowrap}
.badge::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor}
.badge.ok{background:var(--ok-soft);border-color:var(--border-ok);color:var(--ok)}
.badge.warn{background:var(--warn-soft);border-color:var(--border-warn);color:var(--warn)}
.badge.danger{background:var(--danger-soft);border-color:var(--border-danger);color:var(--danger-strong)}

/* --- Bảng ---------------------------------------------------------------- */
.table-wrap{overflow-x:auto}
.table{width:100%;border-collapse:collapse;font-size:var(--fs-sm)}
.table th{text-align:left;font-size:var(--fs-2xs);font-weight:var(--fw-bold);letter-spacing:.05em;
  text-transform:uppercase;color:var(--ink-3);padding:var(--space-4) var(--space-6);
  border-bottom:1px solid var(--border)}
.table td{padding:var(--space-6);border-bottom:1px solid var(--border);vertical-align:top}
.table tr:last-child td{border-bottom:none}
.table tbody tr:hover{background:var(--surface-2)}
.col-right{text-align:right}
/* Bảng nhiều cột KHÔNG được bóp cho vừa cột chính — bóp lại thì mỗi ô xuống ba dòng và bảng
   hết đọc được. Đặt SÀN bề ngang rồi để .table-wrap cuộn ngang TRONG thẻ. Chỉ áp ở ≥961px:
   dưới mốc đó .table-stack đã gập bảng thành thẻ dọc, đặt sàn ở đó là tự sinh cuộn ngang. */
@media (min-width:961px){
  .table.wide{min-width:66rem}
  /* Số tiền, IP, serial, mã cổng KHÔNG được xuống dòng giữa chừng: "3.150.000 đ" gãy chữ "đ"
     xuống dòng dưới là một con số đọc ra hai lần. Chỉ ở ≥961px — dưới đó bảng đã là thẻ dọc. */
  .table td.mono, .table td.col-right{white-space:nowrap}
}

/* --- Thanh hạn ----------------------------------------------------------- */
.wbar-meta{display:flex;justify-content:space-between;gap:var(--space-7);font-size:var(--fs-xs);
  color:var(--ink-3);margin-bottom:var(--space-4)}
.wbar-track{height:8px;border-radius:var(--radius-pill);background:var(--muted-soft);overflow:hidden}
.wbar-fill{height:100%;border-radius:var(--radius-pill);background:var(--ok)}
.wbar-fill.warn{background:var(--warn)}
.wbar-fill.danger{background:var(--danger)}
.wbar-foot{display:flex;justify-content:space-between;gap:var(--space-7);font-size:var(--fs-xs);
  margin-top:var(--space-4);color:var(--ink-3)}
.wbar-foot strong{color:var(--ink);font-weight:var(--fw-semibold)}
.wmini .wbar-track{height:6px}

/* --- Lịch sử ------------------------------------------------------------- */
.tl{position:relative;padding-left:var(--space-10)}
.tl::before{content:"";position:absolute;left:4px;top:6px;bottom:6px;width:1px;background:var(--border)}
.tl-day{font-size:var(--fs-2xs);font-weight:var(--fw-bold);letter-spacing:.06em;text-transform:uppercase;
  color:var(--ink-3);margin:var(--space-9) 0 var(--space-5)}
.tl-day:first-child{margin-top:0}
.tl-item{position:relative;padding:0 0 var(--space-9)}
.tl-item::before{content:"";position:absolute;left:calc(-1 * var(--space-10) + 1px);top:5px;
  width:9px;height:9px;border-radius:50%;background:var(--primary);box-shadow:0 0 0 3px var(--canvas)}
.tl-t{font-weight:var(--fw-semibold)}
.tl-d{font-size:var(--fs-xs);color:var(--ink-2);margin-top:2px}
.tl-m{font-size:var(--fs-xs);color:var(--ink-3);margin-top:2px}

/* --- Rỗng ---------------------------------------------------------------- */
.empty{padding:var(--space-12) var(--space-9);text-align:center;color:var(--ink-3);
  border:1px dashed var(--border-2);border-radius:var(--r-lg);background:var(--surface-2)}
.empty h3{font-size:var(--fs-md);color:var(--ink-2);margin-bottom:var(--space-3)}
.empty p{font-size:var(--fs-xs);max-width:42ch;margin-inline:auto}

/* --- Khối ghi chú của bản xem trước (KHÔNG port) ------------------------- */
.spec-note{margin:var(--space-12) 0 var(--space-9);padding:var(--space-8) var(--space-9);
  border-left:3px solid var(--warm);background:var(--warm-soft);border-radius:0 var(--r) var(--r) 0;
  font-size:var(--fs-xs);color:var(--ink-2)}
.spec-note b{color:var(--ink)}

/* --- Responsive ---------------------------------------------------------- */
@media (max-width:1199px){
  .detail-2col{grid-template-columns:1fr;gap:var(--space-11)}
  .drail{position:static;order:-1}
  .rail-card{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));
    gap:var(--space-7) var(--space-9)}
  .rail-h{grid-column:1/-1;margin-bottom:0}
  .rail-row{border-top:none;padding:0}
}
@media (max-width:960px){
  .sb{position:fixed;left:-260px;z-index:40;transition:left .2s var(--ease)}
  .sb.open{left:0}
  .sb-toggle{display:grid}
  .table-stack thead{display:none}
  .table-stack tr{display:block;padding:var(--space-5) 0;border-bottom:1px solid var(--border)}
  .table-stack tr:hover{background:none}
  .table-stack td{display:flex;justify-content:space-between;gap:var(--space-9);border:none;
    padding:var(--space-2) 0}
  .table-stack td::before{content:attr(data-label);font-weight:var(--fw-semibold);color:var(--ink-3);
    font-size:var(--fs-xs);flex:0 0 auto}
}
@media (min-width:961px){ .sb-toggle{display:none} }
@media (max-width:680px){
  .page{padding:var(--space-9) var(--space-7) var(--space-12)}
  .dcode{font-size:var(--fs-2xl)}
  .dtitle-row{gap:var(--space-8)}
  .dactions{width:100%}
  .btn{flex:1 1 auto;justify-content:center;min-height:40px}
  .act-gap{display:none}
  /* Nút phá KHÔNG kéo hết bề ngang: to bằng nút chính là mời tay bấm nhầm. */
  .dactions .btn.danger-ghost{flex:0 0 auto;margin-top:var(--space-5);margin-left:auto;
    padding-inline:var(--space-10)}
  .card{padding:var(--space-8);border-radius:var(--r)}
  .rail-card{grid-template-columns:1fr 1fr}
}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}
```

**Ba luật về khoảng trắng** (đây là thứ làm bản cũ "trông chưa đẹp"):
- trong một thẻ: `--space-7 … --space-9`
- giữa hai thẻ / hai khối: `--space-11`
- giữa hai KHU (đầu trang ↔ nội dung, cột ↔ cột): `--space-12`, đáy trang `--space-13`

---

## 5. Shell — dán nguyên, chỉ đổi mục `active`

> **Shell trong bản xem trước là BỐI CẢNH, không phải thứ để port.** Sidebar thật nằm ở
> `web/src/shell/` + `css/shell.css` với lớp `.nav-item` / `.nav-item.is-planned`, dựng từ
> `shell/app-nav.ts`. Ở đây dùng `.sb-item` chỉ để trang xem trước đứng một mình chạy được.
> Port nội dung trang, đừng port shell.
>
> Danh sách mục phải khớp `app-nav.ts` (đối chiếu 15/09): **Nghiệp vụ** — Bảng điều khiển ·
> Thiết bị · Phần mềm · Đường truyền · Sắp hết hạn · Địa chỉ IP · Sổ NAT · Tài khoản dịch vụ ·
> Duyệt yêu cầu · Két sắt *(chỉ SA/Admin)* · Kho thanh lý · Tài liệu *(planned)*; **Hệ thống** —
> Tài khoản *(chỉ SA)* · Danh mục · Quyền két sắt *(SA/Admin)* · Nhật ký *(planned)* ·
> Bộ giao diện *(chỉ SA)*. Mục `planned` render ra `<span>` mờ, KHÔNG phải link, kèm
> `title="Phần này chưa mở trong bản hiện tại"`.

Sidebar giữ đúng thứ tự và đúng nhãn của app thật (`web/src/lib/app-nav.ts`). Icon là **SVG nội
tuyến** `stroke="currentColor"`, KHÔNG emoji.

```html
<div class="shell">
  <aside class="sb" id="sb">
    <div class="sb-brand"><span class="sb-logo">IMS</span> IMS</div>
    <nav class="sb-nav">
      <div class="sb-label">Nghiệp vụ</div>
      <a class="sb-item" href="#">…Bảng điều khiển</a>
      <a class="sb-item active" href="#">…Thiết bị</a>      <!-- đổi active theo trang -->
      <a class="sb-item" href="#">…Phần mềm</a>
      <a class="sb-item" href="#">…Đường truyền</a>
      <a class="sb-item" href="#">…Sắp hết hạn</a>
      <a class="sb-item" href="#">…Địa chỉ IP</a>
      <a class="sb-item" href="#">…Sổ NAT</a>
      <a class="sb-item" href="#">…Tài khoản dịch vụ</a>
      <a class="sb-item" href="#">…Duyệt yêu cầu</a>
      <a class="sb-item" href="#">…Két sắt</a>
      <a class="sb-item" href="#">…Kho thanh lý</a>
      <a class="sb-item" href="#">…Tài liệu</a>
      <div class="sb-label">Hệ thống</div>
      <a class="sb-item" href="#">…Tài khoản</a>
      <a class="sb-item" href="#">…Danh mục</a>
      <a class="sb-item" href="#">…Quyền két sắt</a>
      <a class="sb-item" href="#">…Nhật ký</a>
    </nav>
    <div class="sb-foot"><b style="color:var(--sidebar-ink-2)">Nguyễn Minh Hoàng</b><br>
      <span style="font-size:var(--fs-2xs)">Super Admin</span></div>
  </aside>
  <div class="main">
    <header class="topbar">
      <button class="icon-btn sb-toggle" id="sbToggle" aria-label="Mở menu">☰SVG</button>
      <div class="grow">Quản lý hệ thống IT · PMH</div>
      <button class="icon-btn" id="themeBtn" aria-label="Đổi giao diện sáng/tối">…SVG trăng…</button>
    </header>
    <main class="page"> … nội dung trang … </main>
  </div>
</div>
```

---

## 6. Script — dán nguyên

```html
<script>
document.getElementById('themeBtn').onclick = function(){
  var r = document.documentElement;
  r.dataset.theme = r.dataset.theme === 'dark' ? 'light' : 'dark';
};
document.getElementById('sbToggle').onclick = function(){
  document.getElementById('sb').classList.toggle('open');
};
document.querySelectorAll('.tab').forEach(function(tab){
  tab.onclick = function(){
    document.querySelectorAll('.tab').forEach(function(t){ t.classList.remove('active'); });
    document.querySelectorAll('.tabpanel').forEach(function(p){ p.classList.remove('show'); });
    tab.classList.add('active');
    var el = document.getElementById('panel-' + tab.dataset.tab);
    if (el) el.classList.add('show');
  };
});
</script>
```

Tab phải **bấm được thật** — đây là thứ sẽ được kiểm ở Phase 3.

---

## 7. Khối §B — hồ sơ khai sơ sài

Cuối mỗi trang, sau nội dung chính, thêm:

```html
<div class="spec-note"><b>§B — cùng màn này với hồ sơ khai sơ sài.</b>
Đây là trạng thái thường gặp nhất trong dữ liệu thật, và là chỗ bản hiện tại hỏng nặng nhất:
lưới vẽ 5 ô chỉ chứa dấu gạch ngang, rồi ngay dưới lại có dòng "Chưa khai: …" nói lại đúng
mấy ô ấy. Bản v2: ô trống KHÔNG được vẽ, chỉ còn một dòng.</div>
```

rồi dựng lại phần `.detail-2col` (rút gọn, không cần tab) với hồ sơ chỉ có 2–3 trường. Cột phải
chỉ hiện dòng có giá trị; `.dmain` hiện lưới rút gọn + một dòng `.blank-fields`.

---

## 8. Nghiệm thu — trang chưa đạt nếu còn một gạch đầu dòng nào sai

- [ ] Mọi nhãn truy được về `*-detail.tsx` / `vi.ts`. Không có trường, nút, tab, biểu đồ bịa ra.
- [ ] File tự chứa, mở `file://` chạy đủ: không CDN, không font ngoài, không ảnh ngoài.
- [ ] Không có hex rời — mọi màu qua `var(--…)`.
- [ ] Sáng và tối đều đúng; nút đổi theme ở góc phải topbar chạy.
- [ ] Icon là SVG nội tuyến `stroke="currentColor"`; không emoji trong component.
- [ ] Nút chính là `primary`; nút phá là `danger-ghost` và cách cụm chính một `.act-gap`.
- [ ] Không trường nào xuất hiện hai lần trên trang.
- [ ] Ô trống không được vẽ; gom vào một dòng `.blank-fields`.
- [ ] Badge đếm trên tab: `count === 0` thì KHÔNG vẽ `.tab-count`; tab nào **đếm được thì
      phải có số** (Port map cũng có), tab không đếm được (Tổng quan, Lịch sử) thì không có.
- [ ] Tab có thứ cần để mắt bên trong thì mang **chấm cảnh báo** + chữ ẩn cho trình đọc màn
      hình (không dựa vào mỗi màu, WCAG 1.4.1).
- [ ] Thanh tab **dính** khi cuộn (`position: sticky; top: 0`) — bảng dài vẫn đổi tab được.
- [ ] Bảng của khu mở rộng (IP · NAT) phải có **tiêu đề cột**, không nhồi nhiều sự thật vào
      một chuỗi. Cần `DevicePanel.columns/rows` — xem ghi chú trong `thiet-bi.html`.
- [ ] Bảng có `data-label` trên mọi `<td>` và lớp `table-stack` → gập thẻ ở ≤960px.
- [ ] Bảng từ **6 cột trở lên** mang thêm lớp `wide` → cuộn ngang trong thẻ thay vì bóp cột.
- [ ] Không cuộn ngang ở 390px và 768px (`scrollWidth === clientWidth`).
- [ ] Tab bấm được.
- [ ] Có khối §B.
