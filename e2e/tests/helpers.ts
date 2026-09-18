import { execSync } from 'node:child_process';
import { expect, request, type Page } from '@playwright/test';
import { NobleCryptoPlugin, ScureBase32Plugin, TOTP } from 'otplib';

/**
 * Origin của ứng dụng — NGUỒN DUY NHẤT cho mọi request thủ công trong bộ E2E.
 *
 * `CsrfGuard` so `Origin` của request với `APP_BASE_URL` của server. Trước 28/08, 137 chỗ
 * trong `tests/` gõ cứng `https://ims.pmh.com.vn` trong khi CI dựng stack với
 * `APP_BASE_URL=https://localhost` — nghĩa là job `e2e` KHÔNG THỂ xanh: mọi request ghi
 * trả 403 ORIGIN_MISMATCH. Đó là lý do CI chưa từng chạy được, và mọi con số "xanh
 * 235/235" đều là tự khai trên máy dev. Xem `docs/CODE-REVIEW-2026-08-28.md` (F-QA-01).
 *
 * Đặt `IMS_BASE_URL` là đổi cả baseURL của Playwright lẫn Origin gửi lên — hai thứ đó
 * BẮT BUỘC phải khớp nhau, nên chúng phải đọc từ cùng một biến.
 */
export const APP_ORIGIN = process.env.IMS_BASE_URL ?? 'https://ims.pmh.com.vn';

export const E2E_SA = { email: 'e2e-sa@pmh.com.vn', password: 'E2e@Test#2026' };
export const E2E_MEMBER = { email: 'e2e-member@pmh.com.vn', password: 'E2e@Test#2026' };
export const NEW_PASSWORD = 'Ims#Manh2026!ok';

/**
 * Đưa tài khoản E2E về trạng thái vừa-được-tạo. Gọi ở beforeEach vì test đăng nhập
 * làm THAY ĐỔI trạng thái thật (đổi mật khẩu, cài TOTP, khóa tài khoản) — không reset
 * thì test sau ăn theo test trước và đỏ ngẫu nhiên.
 */
export const COMPOSE =
  'docker compose -f docker-compose.yml -f docker-compose.override.e2e.yml';

/** Trần đăng nhập/IP mà cả bộ E2E chạy dưới — đủ cao để không ai đụng phải do chạy nhiều. */
export const E2E_LOGIN_RATE_LIMIT = 500;

/**
 * CHẠY MỘT LỆNH `docker compose exec` — CÓ THỬ LẠI. Mọi helper chạm stack đều đi qua đây.
 *
 * ===== TRIỆU CHỨNG (ĐÃ QUAN SÁT) =====
 *
 * Trong ba lượt E2E đầy đủ ngày 09/09, `docker compose exec` hỏng giữa chừng — quanh bài thứ
 * ~61, sau ~6 phút. `execSync` ném với **stderr RỖNG**, chỉ còn dòng "Command failed". Ngay
 * sau đó chạy TAY đúng lệnh ấy thì xong trong dưới 1 giây, api `healthy`, 0 lần khởi động
 * lại, không một dòng lỗi trong log.
 *
 * Hậu quả lớn hơn nguyên nhân: một lần trượt → bài đó đỏ, và vì dữ liệu không được dọn nên
 * hơn 50 bài sau đỏ theo. Cả lượt 25 phút hỏng vì một lần gọi tiến trình con.
 *
 * ===== NGUYÊN NHÂN: CHƯA BIẾT. ĐÃ LOẠI ĐƯỢC "HẾT BỘ NHỚ" =====
 *
 * Giả thuyết đầu tiên là máy hết bộ nhớ nên không dựng nổi tiến trình con. ĐÃ ĐO VÀ BÁC BỎ
 * (09/09), bằng cách lấy mẫu `\Memory\Available MBytes` mỗi 3 giây TRONG LÚC bộ E2E chạy:
 *
 *     thấp nhất 4 716 MB · trung bình 6 057 MB · trên tổng 24 GB
 *     máy ảo Docker: 7,76 GiB, toàn bộ container dùng ~700 MB
 *
 * Còn dư rất nhiều ở cả hai phía. Con số từng dùng để kết luận (`FreePhysicalMemory` = 4,3 GB)
 * là số ĐO SAI CÁCH: chỉ tiêu đó của Windows bỏ qua standby cache nên luôn thấp hơn thực tế,
 * và nó được đo SAU lượt hỏng chứ không phải trong lúc hỏng.
 *
 * Còn lại chưa loại được: Docker Desktop chỉ được cấp 2 nhân trên 8 luồng của máy — tranh CPU
 * là ứng viên hợp lý hơn. Nhưng đó CŨNG chỉ là giả thuyết, và bài học của lần trước là đừng
 * viết giả thuyết ra như kết luận.
 *
 * Vì vậy khối `catch` dưới đây GHI LẠI `code`/`status`/`signal`. Lần hỏng tới sẽ tự nói ra
 * nguyên nhân thay vì để người đọc đoán tiếp — đó mới là việc cần làm ở đây.
 *
 * ===== VÌ SAO THỬ LẠI Ở ĐÂY LÀ ĐÚNG =====
 *
 * Mọi lệnh đi qua cửa này đều TOÀN PHẦN: đọc một giá trị, đặt một giá trị về hằng số, hoặc
 * dọn một vùng về trạng thái cố định. Chạy hai lần cho kết quả y hệt chạy một lần. Thử lại
 * một lệnh GHI NGHIỆP VỤ thì mới là giấu lỗi đi — cửa này không có lệnh nào như vậy.
 *
 * CÓ NGHỈ giữa hai lượt: bản đầu bắn ba lượt liên tiếp và cả ba cùng hỏng, vì thử lại tức thì
 * là đâm vào đúng bức tường vừa đâm. `Atomics.wait` chứ không `await`: nhiều nơi gọi nằm
 * trong `beforeEach` ĐỒNG BỘ, và `execSync('sleep')` không có trên Windows.
 *
 * Ba lượt, không nhiều hơn: hỏng THẬT (api chết, sai cấu hình, SQL sai) phải đỏ nhanh và đỏ
 * rõ, chứ không được biến thành một bài kiểm treo lâu gấp ba rồi mới chịu nói.
 */
function dockerExec(command: string, label: string, env?: NodeJS.ProcessEnv): string {
  const options = { cwd: '..', stdio: 'pipe' as const, ...(env ? { env } : {}) };
  for (let attempt = 1; ; attempt += 1) {
    try {
      return execSync(command, options).toString();
    } catch (error) {
      if (attempt < 3) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, attempt * 1_000);
        continue;
      }
      /*
       * IN RA ĐỦ THỨ CẦN ĐỂ CHẨN, KHÔNG ĐOÁN HỘ NGƯỜI ĐỌC.
       *
       * "Command failed" trần trụi là thứ đã tốn một giờ mà vẫn KHÔNG kết luận được nguyên
       * nhân. Ba trường dưới đây phân biệt được các khả năng ngay từ dòng đầu:
       *
       *   `code: 'ENOMEM'`  → máy không dựng nổi tiến trình con (giả thuyết hiện tại).
       *   `code: 'ETIMEDOUT'` → lệnh chạy quá lâu, không phải không chạy được.
       *   `signal: 'SIGKILL'` → có thứ khác giết tiến trình.
       *   `status: 1` + stderr → docker/psql trả lỗi THẬT: sai SQL, container chết.
       *
       * Không có ba trường này thì bốn nguyên nhân trên trông y hệt nhau.
       */
      const e = error as { stderr?: Buffer; code?: unknown; status?: unknown; signal?: unknown };
      const stderr = String(e.stderr ?? '').trim();
      const facts = [
        e.code === undefined ? null : `code=${String(e.code)}`,
        e.status === undefined || e.status === null ? null : `status=${String(e.status)}`,
        e.signal ? `signal=${String(e.signal)}` : null,
      ]
        .filter(Boolean)
        .join(' ');

      throw new Error(
        `${label} hỏng sau 3 lần thử [${facts || 'không có code/status/signal'}].` +
          (stderr
            ? `\n${stderr}`
            : ' stderr RỖNG — lệnh không chạy được, KHÔNG phải lỗi SQL. Xem `code` ở trên.'),
        { cause: error },
      );
    }
  }
}

/**
 * Đọc trần đăng nhập theo IP đang có trong `system_config`.
 * Dùng để bài kiểm rate-limit tự trả lại đúng giá trị nó mượn.
 */
export function getLoginRateLimit(): string {
  return dockerExec(
    `${COMPOSE} exec -T postgres psql -U ims -d ims -tAc "SELECT value FROM system_config WHERE key = 'login.rate_limit_per_ip'"`,
    'Đọc trần đăng nhập',
  ).trim();
}

/**
 * Đặt trần đăng nhập theo IP. CHỈ dùng trong E2E.
 *
 * ===== VÌ SAO PHẢI `flushResets()` TRƯỚC =====
 *
 * `resetUsers()` không dọn ngay — từ 07/09 (`b3d488f`) nó chỉ XẾP HÀNG, và `flushResets()`
 * mới thật sự chạy `reset-e2e.mjs`, do fixture gọi NGAY TRƯỚC thân bài kiểm. Mà trong domain
 * `users` của script đó có đúng một dòng:
 *
 *     UPDATE system_config SET value = '500' WHERE key = 'login.rate_limit_per_ip'
 *
 * Nên `beforeAll` viết như mọi người sẽ viết —
 *
 *     resetUsers();            // xếp hàng
 *     setLoginRateLimit(3);    // DB = 3
 *                              // …fixture flush: DB = 500  ← đè mất
 *
 * — cho ra trần 500 lúc bài chạy. Đó chính là chuyện đã xảy ra với
 * `login-rate-limit.spec.ts` KỂ TỪ 07/09: bài canh hàng rào chống dò mật khẩu chạy với trần
 * 500 nên không bao giờ chạm 429, và nó im lặng cho tới lượt `--e2e` đầy đủ ngày 09/09 —
 * lượt đầy đủ đầu tiên kể từ hôm đó. Một tối ưu tốc độ đã tắt một bài kiểm bảo mật.
 *
 * Sửa ở ĐÂY chứ không ở spec: nơi nào GHI cấu hình cũng phải tự làm cạn hàng đợi có thể ghi
 * đè nó. Vá trong một spec thì spec thứ hai — viết sau, bởi người khác — lại dính y hệt.
 */
export function setLoginRateLimit(value: number): void {
  flushResets();
  dockerExec(
    `${COMPOSE} exec -T postgres psql -U ims -d ims -c "UPDATE system_config SET value = '${value}' WHERE key = 'login.rate_limit_per_ip'"`,
    'Đặt trần đăng nhập',
  );
}

/**
 * Đẩy mốc step-up của mọi phiên lùi 1 giờ — giả lập "hết grace 10 phút" mà không phải chờ.
 *
 * Cách khác là hạ `secret.stepup_grace_minutes` xuống 0, nhưng SystemConfigService cache 30
 * giây nên test sẽ phải ngồi chờ cache hết hạn, và grace 0 thì gõ mã xong cũng vẫn hết hạn
 * ngay — không kiểm được luồng "gõ mã rồi xem tiếp".
 */
export function expireStepUp(email: string): void {
  /*
   * KHOANH VÀO ĐÚNG MỘT NGƯỜI (09/09).
   *
   * Bản trước không có `WHERE user_id`: nó đẩy `stepped_up_at` lùi một giờ cho MỌI phiên còn
   * sống trong DB. Playwright chạy nhiều worker song song, nên một bài kiểm đang ở giữa luồng
   * "gõ mã xong rồi xem tiếp" bị bài khác cắt mất quyền — đỏ ngẫu nhiên, đỏ ở một file không
   * hề gọi hàm này, và mỗi lần chạy lại một chỗ khác. Đúng loại đỏ giả làm người ta ngừng tin
   * cả bộ test.
   *
   * Bắt buộc truyền email chứ không đặt mặc định: mặc định là cách một lời gọi thiếu sót lại
   * lặng lẽ quét cả DB lần nữa.
   */
  dockerExec(
    `${COMPOSE} exec -T postgres psql -U ims -d ims -c "UPDATE sessions SET stepped_up_at = now() - interval '1 hour' WHERE revoked_at IS NULL AND user_id = (SELECT id FROM users WHERE email = '${email}')"`,
    'Hết hạn step-up',
  );
}

/** Đếm số dòng audit của một hành động trên một secret — dùng để kiểm "mỗi lần mở = một dòng". */
/**
 * ĐỌC NỘI DUNG dòng audit mới nhất, không chỉ đếm.
 *
 * `countAudit` trả lời "có mấy dòng" — và cho tới 17/09/2026 đó là TẤT CẢ những gì bộ kiểm hỏi
 * về nhật ký mở két. Nghĩa là đổi `actor` thành hằng `'system'`, hay bỏ mất `grantId` (thứ nói
 * "mở được là nhờ phiếu break-glass nào"), đều không làm bài nào đỏ — trong khi tờ giấy nộp
 * auditor sẽ nói "có người xem" mà không nói được ai, hoặc không nói được bằng quyền gì.
 *
 * Trả `actor` và `detail` thô (JSON dạng chuỗi) để nơi gọi tự khẳng định.
 */
export function lastAudit(
  action: string,
  objectId: string,
): { actor: string; detail: string } | null {
  /*
   * Ghép hai cột TRONG SQL thay vì dùng `-F` của psql: tham số `-F '|'` đi qua `execSync` trên
   * Windows thì dấu nháy đơn không sống sót, psql thoát với status 255 và bài kiểm đỏ vì một
   * lý do chẳng liên quan gì tới thứ nó kiểm. `countAudit` ngay dưới không vấp vì nó chỉ có
   * một cột. Dấu ngăn phải là chuỗi không thể xuất hiện trong email hay JSON.
   */
  const out = dockerExec(
    `${COMPOSE} exec -T postgres psql -U ims -d ims -t -A -c ` +
      `"SELECT actor || '~|~' || coalesce(detail::text, '') FROM audit_log ` +
      `WHERE action = '${action}' AND object_id = '${objectId}' ORDER BY created_at DESC LIMIT 1"`,
    'Đọc dòng audit mới nhất',
  ).trim();
  if (!out) return null;
  const at = out.indexOf('~|~');
  return { actor: out.slice(0, at), detail: out.slice(at + 3) };
}

export function countAudit(action: string, objectId: string): number {
  const out = dockerExec(
    `${COMPOSE} exec -T postgres psql -U ims -d ims -t -A -c ` +
      `"SELECT count(*) FROM audit_log WHERE action = '${action}' AND object_id = '${objectId}'"`,
    'Đếm dòng audit',
  );
  return Number(out.trim());
}

/**
 * Đếm dòng audit theo NGƯỜI — cho những hành động không gắn với một đối tượng nào.
 *
 * ===== VÌ SAO CẦN NÓ, THAY VÌ ĐẾM THƯ TRONG HỘP =====
 *
 * `security.probe.alerted` có `object_id = NULL` (nó nói về một PHIÊN dò dẫm, không về một
 * ngăn cụ thể), nên `countAudit` không hỏi được.
 *
 * Nhưng lý do thật sự quan trọng hơn: câu "đủ ngưỡng thì CHỈ một lá thư" trước đây được hỏi
 * bằng `expect((await waitForMail(...)).length).toBe(1)`, và đó là một CUỘC ĐUA chứ không
 * phải một khẳng định. `waitForMail` trả về NGAY ở lượt poll đầu tiên thấy ≥1 thư khớp — nó
 * không chờ hộp thư lắng. Xoá trọn khối thời-gian-nghỉ trong `SecurityProbeService` thì lượt
 * 3,4,5,6 mỗi lượt đẩy một job, nhưng bốn lá ấy đi qua outbox → BullMQ → SMTP BẤT ĐỒNG BỘ;
 * bài kiểm poll mỗi 500ms và chỉ cần thấy lá đầu là trả về `[1 lá]` → `toBe(1)` XANH.
 *
 * Dòng vết thì khác: nó commit ĐỒNG BỘ, trong cùng transaction với lượt đẩy thư, trước khi
 * request thứ N trả về. Hỏi DB là hỏi đúng thứ đã xảy ra, không phải thứ vừa kịp tới nơi.
 *
 * Giữ `waitForMail(...).length >= 1` cho vế "thư có đi thật" — hai câu hỏi khác nhau, hai
 * công cụ khác nhau.
 */
export function countAuditByActor(action: string, actor: string): number {
  const out = dockerExec(
    `${COMPOSE} exec -T postgres psql -U ims -d ims -t -A -c ` +
      `"SELECT count(*) FROM audit_log WHERE action = '${action}' AND actor = '${actor}'"`,
    'Đếm dòng audit theo người',
  );
  return Number(out.trim());
}

/**
 * ===== GOM MỌI LỆNH DỌN VÀO MỘT LƯỢT `docker compose exec` =====
 *
 * Bản trước có 11 hàm reset, mỗi hàm tự `execSync` một lệnh riêng, và mỗi `beforeEach` gọi
 * 2-5 hàm. Đo trên máy này: **một lần `docker compose exec` tốn 0,46 giây**. Nhân với ~900
 * lượt gọi trong một lượt chạy đầy đủ là **~7 phút thuần overhead** — nhiều hơn cả thời gian
 * trình duyệt thật sự làm việc ở phần lớn các bài.
 *
 * Nay các hàm `resetX()` chỉ GHI TÊN VÙNG vào một hàng đợi; lượt `exec` DUY NHẤT xảy ra ở
 * `flushResets()`, do fixture `test.beforeEach` trong `tests/fixtures.ts` gọi. Nhờ vậy call
 * site trong 47 spec không phải sửa một dòng nào, mà số lần `exec` giảm từ ~900 xuống ~264.
 *
 * Thứ tự dọn KHÔNG phụ thuộc thứ tự gọi: script `reset-e2e.mjs` tự xếp theo phụ thuộc khóa
 * ngoại (devices phải sau software vì `license_assignment` trỏ cả hai chiều).
 */
const DOMAIN_ORDER = [
  'users',
  'access-list',
  'approvals',
  'secrets',
  'service-accounts',
  'software',
  'ipam',
  'isp',
  'devices',
  'digest-rules',
  'catalog',
] as const;

type ResetDomain = (typeof DOMAIN_ORDER)[number];

const pending = new Set<ResetDomain>();
let flushScheduled = false;

/**
 * Xếp một vùng vào hàng đợi và hẹn xả ở CUỐI TICK hiện tại.
 *
 * Vì sao `queueMicrotask` chứ không phải một fixture của Playwright: Playwright dựng fixture
 * TRƯỚC khi chạy `beforeEach` của spec, nên fixture sẽ xả hàng đợi lúc nó còn rỗng. Không có
 * hook nào chạy SAU `beforeEach`.
 *
 * Còn `beforeEach` của mọi spec đều là một khối đồng bộ (`() => { resetUsers(); resetDevices(); }`),
 * nên mọi lời gọi rơi vào cùng một tick; microtask xả ngay sau khối đó và luôn xong trước thân
 * bài test, vì Playwright `await` kết quả của hook. Spec nào viết `beforeEach` bất đồng bộ thì
 * microtask nổ ở lần `await` đầu tiên — vẫn trước thân bài.
 */
function queue(domain: ResetDomain): void {
  pending.add(domain);
  if (flushScheduled) return;
  flushScheduled = true;
  queueMicrotask(() => {
    flushScheduled = false;
    flushResets();
  });
}

/**
 * Chạy MỘT lệnh dọn cho tất cả vùng đang xếp hàng. Gọi từ fixture, không gọi trong spec.
 *
 * `ALLOW_E2E_RESET=1` là chốt chặn thật trong chính script: không có biến đó thì nó từ chối
 * chạy, để production không tồn tại đường đặt lại mật khẩu về chuỗi có sẵn trong repo.
 */
export function flushResets(): void {
  if (pending.size === 0) return;
  const domains = DOMAIN_ORDER.filter((d) => pending.has(d));
  pending.clear();
  dockerExec(
    `${COMPOSE} exec -T api node scripts/reset-e2e.mjs ${domains.join(' ')}`,
    `Dọn dữ liệu E2E (${domains.join(' ')})`,
    { ...process.env, ALLOW_E2E_RESET: '1' },
  );
}

/**
 * Đưa tài khoản E2E về trạng thái vừa-được-tạo, và nới trần đăng nhập cho môi trường test.
 *
 * Gọi ở `beforeEach` vì test đăng nhập làm THAY ĐỔI trạng thái thật (đổi mật khẩu, cài TOTP,
 * khóa tài khoản) — không reset thì test sau ăn theo test trước và đỏ ngẫu nhiên.
 */
export function resetUsers(): void {
  queue('users');
}

/** Xóa thiết bị do E2E tạo, kèm file · secret · IP · NAT · port · lịch sử của chúng. */
export function resetDevices(): void {
  queue('devices');
}

/** Xóa hồ sơ phần mềm do E2E tạo. Quy ước: mã luôn chứa "E2E". */
export function resetSoftware(): void {
  queue('software');
}

/** Xóa dải và hồ sơ IP do E2E tạo. Quy ước: mọi TÊN dải trong test đều chứa "E2E". */
export function resetIpam(): void {
  queue('ipam');
}

/** Xóa dữ liệu danh mục do E2E tạo (mã bắt đầu bằng `E2E-`, hoặc tên chứa "E2E"). */
export function resetCatalog(): void {
  queue('catalog');
}

/**
 * Xóa secret do E2E cất. Quy ước: mọi nhãn secret trong test đều chứa "E2E".
 *
 * Bảng `secret` không có FK sang device/software (tham chiếu lỏng, AD-4) nên xóa thiết bị
 * KHÔNG kéo theo secret — không có câu này thì nhãn của lần chạy trước ở lại và ràng buộc
 * "một chủ thể một nhãn" bắt trúng bản ghi mồ côi.
 */
export function resetSecrets(): void {
  queue('secrets');
}

/** Xóa tài khoản dịch vụ do E2E tạo, kèm secret · giấy tờ · lịch sử của chúng. */
export function resetServiceAccounts(): void {
  queue('service-accounts');
}

/** Xóa mọi lời gán quyền két sắt của tài khoản E2E — ma trận phải sạch giữa các lần chạy. */
export function resetAccessList(): void {
  queue('access-list');
}

/** Xóa yêu cầu duyệt do E2E tạo (người xin là tài khoản e2e). */
export function resetApprovals(): void {
  queue('approvals');
}

/** Xóa luật gửi báo cáo do E2E tạo. Quy ước: mọi tên luật trong test đều chứa "E2E". */
export function resetDigestRules(): void {
  queue('digest-rules');
}

/** Xóa đường truyền ISP do E2E tạo (mã luôn chứa "E2E"). */
export function resetIsp(): void {
  queue('isp');
}

const totp = new TOTP({
  crypto: new NobleCryptoPlugin(),
  base32: new ScureBase32Plugin(),
  period: 30,
  digits: 6,
});

/** Test đóng vai app Authenticator: sinh mã 6 số từ secret hiện trên màn enroll. */
export async function totpCode(secret: string): Promise<string> {
  return totp.generate({ secret });
}

const usedCodes = new Set<string>();

/**
 * Mã CHƯA từng dùng trong lần chạy test này.
 *
 * Chống replay (NFR-01) từ chối mã đã dùng — nên hai lần đăng nhập cách nhau vài giây
 * sẽ nhận cùng một mã và lần thứ hai bị chặn ĐÚNG THEO THIẾT KẾ. Test phải chờ sang
 * chu kỳ 30 giây kế tiếp thay vì coi đó là lỗi.
 */
export async function freshTotpCode(secret: string): Promise<string> {
  let code = await totpCode(secret);
  while (usedCodes.has(code)) {
    const msToNextWindow = 30_000 - (Date.now() % 30_000) + 1_000;
    await new Promise((resolve) => setTimeout(resolve, msToNextWindow));
    code = await totpCode(secret);
  }
  usedCodes.add(code);
  return code;
}

export async function fillLogin(page: Page, email: string, password: string): Promise<void> {
  /*
   * NUỐT ĐÚNG MỘT LỖI, VÀ CHỈ KHI ĐÍCH ĐẾN TRÙNG (09/09).
   *
   * Sau `logout()`, trang tự đi tới `/login` HAI lượt cách nhau 2ms: `navigate()` trong
   * `onSuccess`, rồi NẠP LẠI CỨNG do `apiFetch` gặp 401 ở lượt `me` kế tiếp. Lượt `goto`
   * của ta rơi vào giữa thì Playwright ném "Navigation to .../login is interrupted by
   * another navigation to .../login".
   *
   * Lỗi ấy vô hại THEO ĐỊNH NGHĨA: nó nói rằng có người khác vừa chở ta tới ĐÚNG chỗ ta
   * đang muốn tới. Nên bắt đúng nó, và chỉ khi đích đến là `/login` — mọi lỗi điều hướng
   * khác (mạng chết, api sập, chuyển sang URL khác) vẫn ném nguyên. Không thử lại, không
   * `catch` trần: một `catch(() => {})` ở đây sẽ nuốt luôn cả những lần server thật sự hỏng.
   */
  await page.goto('/login').catch((error: unknown) => {
    if (!/interrupted by another navigation to \S*\/login/.test(String(error))) throw error;
  });
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
}

/**
 * Đi hết luồng lần đầu: mật khẩu tạm → cài 2 lớp → đổi mật khẩu → vào app.
 * Trả về secret TOTP để test sau còn đăng nhập lại được.
 */
export async function firstLogin(
  page: Page,
  user: { email: string; password: string },
  newPassword = NEW_PASSWORD,
): Promise<string> {
  await fillLogin(page, user.email, user.password);

  await expect(page.getByRole('heading', { name: 'Cài xác thực 2 lớp' })).toBeVisible();
  const secret = (await page.getByTestId('totp-secret').innerText()).trim();
  expect(secret.length).toBeGreaterThan(15);

  await page.getByLabel('Nhập mã 6 số đầu tiên để xác nhận').fill(await freshTotpCode(secret));
  await page.getByRole('button', { name: 'Xác nhận' }).click();

  await expect(page.getByRole('heading', { name: 'Đổi mật khẩu' })).toBeVisible();
  await page.getByLabel('Mật khẩu hiện tại').fill(user.password);
  await page.getByLabel('Mật khẩu mới', { exact: true }).fill(newPassword);
  await page.getByLabel('Nhập lại mật khẩu mới').fill(newPassword);
  await page.getByRole('button', { name: 'Lưu' }).click();

  await expect(page.getByRole('heading', { name: /Xin chào/ })).toBeVisible();
  return secret;
}

/** Đăng nhập lại khi đã cài TOTP và đã đổi mật khẩu. */
export async function loginWithTotp(
  page: Page,
  email: string,
  password: string,
  secret: string,
): Promise<void> {
  await fillLogin(page, email, password);
  await expect(page.getByRole('heading', { name: 'Xác thực 2 lớp' })).toBeVisible();
  await page.getByLabel('Mã xác thực').fill(await freshTotpCode(secret));
  await page.getByRole('button', { name: 'Xác nhận' }).click();
  await expect(page.getByRole('heading', { name: /Xin chào/ })).toBeVisible();
}

/**
 * Mailpit — hộp thư của môi trường dev/test. SMTP thật chỉ bật ở prod.
 *
 * Ba hàm dưới đây TỪNG nằm riêng trong `expiry-digest.spec.ts`. Epic 6 cũng gửi thư (báo
 * người duyệt khi có yêu cầu treo, nhắc yêu cầu quá hạn) nên chúng chuyển ra đây thay vì bị
 * chép sang file thứ hai — AD-15 cấm bản sao.
 */
export const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8025';

export interface MailSummary {
  ID: string;
  Subject: string;
  To: { Address: string }[];
}

export async function clearMailbox(): Promise<void> {
  const api = await request.newContext();
  await api.delete(`${MAILPIT}/api/v1/messages`).catch(() => undefined);
  await api.dispose();
}

/**
 * Chờ thư có tiêu đề khớp — KHÔNG lấy bừa thư đầu hộp: luồng đăng nhập lần đầu cũng gửi
 * email "thiết bị mới", nên thư đầu tiên trong hộp thường không phải thư mình đang chờ.
 */
export async function waitForMail(subjectPart: string, attempts = 40): Promise<MailSummary[]> {
  const api = await request.newContext();
  try {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const res = await api.get(`${MAILPIT}/api/v1/messages`);
      if (res.ok()) {
        const body = (await res.json()) as { messages: MailSummary[] };
        const matched = body.messages.filter((mail) => mail.Subject.includes(subjectPart));
        if (matched.length > 0) return matched;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return [];
  } finally {
    await api.dispose();
  }
}

/**
 * Chụp danh sách thư HIỆN CÓ — khác `waitForMail` ở chỗ nó không chờ gì cả.
 *
 * Sinh ra cho vế phủ định: "bấm Hủy thì KHÔNG được có thư nào rời đi". Dùng `waitForMail` cho
 * việc đó là sai công cụ — nó chờ tới 20 giây rồi trả mảng rỗng, nên bài kiểm vừa chậm vừa
 * không phân biệt được "không gửi" với "gửi chậm".
 */
export async function mailpitMessages(): Promise<MailSummary[]> {
  const api = await request.newContext();
  try {
    const res = await api.get(`${MAILPIT}/api/v1/messages`);
    if (!res.ok()) return [];
    return ((await res.json()) as { messages: MailSummary[] }).messages;
  } finally {
    await api.dispose();
  }
}

export async function mailBody(id: string): Promise<string> {
  const api = await request.newContext();
  const res = await api.get(`${MAILPIT}/api/v1/message/${id}`);
  const body = (await res.json()) as { Text?: string; HTML?: string };
  await api.dispose();
  return `${body.Text ?? ''}
${body.HTML ?? ''}`;
}

/**
 * Đổi một khóa `system_config` (AD-11).
 *
 * CẨN THẬN: `SystemConfigService` cache 30 giây. Test nào đổi ngưỡng rồi kiểm hệ quả NGAY
 * sẽ đọc phải giá trị cũ và xanh/đỏ vì lý do chẳng liên quan — phải chờ qua cache
 * (`CONFIG_CACHE_MS`) hoặc chọn cách kiểm không phụ thuộc thời điểm.
 */
export const CONFIG_CACHE_MS = 31_000;

export function setConfig(key: string, value: string): void {
  dockerExec(
    `${COMPOSE} exec -T postgres psql -U ims -d ims -c ` +
      `"UPDATE system_config SET value = '${value}' WHERE key = '${key}'"`,
    `Đặt cấu hình ${key}`,
  );
}

export function getConfig(key: string): string {
  return dockerExec(
    `${COMPOSE} exec -T postgres psql -U ims -d ims -t -A -c ` +
      `"SELECT value FROM system_config WHERE key = '${key}'"`,
    `Đọc cấu hình ${key}`,
  ).trim();
}

/** Chạy một câu SQL bất kỳ và trả về chữ — dùng để dựng trạng thái mà UI không dựng được. */
export function sql(query: string): string {
  return dockerExec(
    `${COMPOSE} exec -T postgres psql -U ims -d ims -t -A -c "${query}"`,
    `Câu SQL: ${query.slice(0, 60)}`,
  ).trim();
}

/** Token CSRF của phiên đang mở — mọi lệnh ghi qua API đều phải kèm. */
export async function csrfOf(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const res = await fetch('/api/v1/auth/me', { credentials: 'include' });
    return ((await res.json()) as { csrfToken: string }).csrfToken;
  });
}

/**
 * Header đủ để gọi API ghi từ trong test (CSRF + Origin hợp lệ).
 *
 * Dùng `APP_ORIGIN`, KHÔNG gõ cứng. Đợt 28/08 gom 137 chỗ hardcode `Origin` về hằng chung
 * nhưng bỏ sót đúng cái helper dùng chung này — nó vẫn ghi thẳng `https://ims.pmh.com.vn`.
 * Ở máy dev thì trùng nên không ai thấy; chạy với `IMS_BASE_URL=https://localhost` (đúng cấu
 * hình CI) là mọi lệnh ghi qua helper này trả 403 ORIGIN_MISMATCH. Lỗi cũ, chỉ lộ ở đúng môi
 * trường mà bản sửa kia sinh ra để phục vụ.
 */
export async function writeHeaders(page: Page): Promise<Record<string, string>> {
  return { 'X-CSRF-Token': await csrfOf(page), Origin: APP_ORIGIN };
}

/**
 * Tuỳ chọn cho test cần MỘT TRÌNH DUYỆT THỨ HAI (`browser.newContext()`).
 *
 * `newContext()` KHÔNG thừa kế mục `use` trong `playwright.config.ts`. Thiếu
 * `ignoreHTTPSErrors` là mọi request chết vì cert dev tự ký, và thiếu `baseURL` là
 * `goto('/')` không biết đi đâu — cả hai đều đỏ theo kiểu chẳng liên quan gì tới bài test.
 */
export const SECOND_BROWSER = {
  baseURL: APP_ORIGIN,
  ignoreHTTPSErrors: true,
  locale: 'vi-VN',
  timezoneId: 'Asia/Ho_Chi_Minh',
} as const;

/**
 * Số pixel trang bị tràn ngang. 0 (hoặc 1 do làm tròn) = không tràn.
 *
 * TỪNG có NĂM bản chép của hàm này, mỗi file `*.mobile.spec.ts` một bản — và chúng ĐÃ TRÔI:
 * bốn bản trả về số pixel, riêng bản trong `shared-kit.mobile.spec.ts` trả về boolean với
 * ngưỡng `+1` nằm bên trong. Cùng một cái tên, hai ý nghĩa khác nhau, không có gì báo.
 * Đúng lý do AD-15 cấm bản sao: bản sao không sai lúc chép, nó sai dần về sau.
 */
/**
 * Bấm nút XÁC NHẬN trong hộp hỏi lại (`ConfirmDialog`).
 *
 * Không bám vào chữ trên nút: nhãn giờ là ĐỘNG TỪ của hành động ("Khoá", "Xoá", "Gỡ"…) chứ
 * không còn là "Đồng ý" chung chung — đó là chủ đích, vì hộp hỏi "Khoá tài khoản A?" mà nút
 * ghi "Đồng ý" thì người dùng phải đọc lại câu hỏi mới biết mình sắp làm gì. Bám vào vị trí
 * (nút cuối trong chân hộp, sau nút Hủy — thứ tự nhất quán toàn app) để đổi câu chữ không
 * làm đỏ 16 bài kiểm.
 *
 * Truyền `label` khi bài kiểm CỐ TÌNH muốn chốt đúng chữ trên nút.
 */
export async function confirmAction(page: Page, label?: string): Promise<void> {
  const footer = page.getByTestId('dialog-footer').last();
  if (label) {
    await footer.getByRole('button', { name: label }).click();
    return;
  }
  await footer.getByRole('button').last().click();
}

/**
 * Đăng xuất qua giao diện, dùng được ở CẢ desktop lẫn 390px.
 *
 * Nút "Đăng xuất" nằm ở chân sidebar — mà ở màn hẹp sidebar là drawer đang đóng. Bản chép
 * trong từng spec chỉ bấm thẳng nút nên treo 60 giây ở 390px; gom về đây theo AD-15.
 *
 * ===== VÌ SAO PHẢI CHỜ PHẢN HỒI, KHÔNG CHỈ BẤM (09/09) =====
 *
 * Bản trước trả về NGAY sau `.click()`. Nhưng nút chỉ `logout.mutate(...)` rồi mới
 * `navigate('/login')` trong `onSuccess` — nghĩa là lúc hàm này trả về, `POST /auth/logout`
 * mới đang bay. Bài kiểm gọi tiếp `fillLogin`, mà việc đầu tiên của nó là `page.goto('/login')`
 * — và điều hướng thì HỦY mọi request đang bay. Lượt đăng xuất chết giữa đường
 * (`net::ERR_ABORTED`), phiên cũ vẫn sống, `AppRoutes` thấy `step === '/'` ở màn đăng nhập nên
 * đá thẳng về `/`. Bài kiểm đứng chờ ô Email trên màn ĐÃ ĐĂNG NHẬP cho tới hết 60 giây, và đỏ
 * ở `locator.fill` — một chỗ chẳng liên quan gì tới điều nó đang kiểm.
 *
 * ĐÃ ĐO, không phải suy đoán: giữ phản hồi logout lại 800ms rồi `goto('/login')` ngay sau khi
 * bấm → số phiên còn sống 16 → 16 (không đổi), ô Email không hiện, URL nhảy về `/`. Đúng ảnh
 * chụp của lượt đỏ. Không giữ lại thì máy thường thắng cuộc đua — nên nó CHẬP CHỜN chứ không
 * đỏ đều, và đó là kiểu hỏng tệ nhất: nó dạy người ta chạy lại thay vì đọc.
 *
 * Chờ đúng cái phản hồi ấy là chốt chặn thật: phản hồi về nghĩa là transaction thu hồi phiên
 * đã commit. Sau đó mới được rời khỏi hàm này.
 */
export async function logout(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('banner')).toBeVisible();
  const openNav = page.getByRole('button', { name: 'Mở menu' });
  if (await openNav.count()) await openNav.click();

  const done = page.waitForResponse(
    (res) => res.url().includes('/api/v1/auth/logout') && res.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Đăng xuất' }).click();
  const res = await done;
  expect(
    res.status(),
    'đăng xuất phải thành công — không thì bài sau chạy với phiên cũ',
  ).toBeLessThan(300);

  /*
   * ===== VÀ PHẢI CHỜ TRANG LẮNG XUỐNG, KHÔNG CHỈ CHỜ PHẢN HỒI =====
   *
   * ĐO ĐƯỢC (nghe `framenavigated`): lúc phản hồi logout về, trình duyệt CÒN ĐANG ở `/`. Ngay
   * sau đó có HAI lượt điều hướng tới `/login` cách nhau 2ms — lượt đầu là `navigate()` trong
   * `onSuccess`, lượt sau là NẠP LẠI CỨNG do `apiFetch` gặp 401 ở lần gọi `me` kế tiếp
   * (`window.location.href = LOGIN_PATH`).
   *
   * Trả về giữa hai lượt đó thì `page.goto('/login')` của `fillLogin` đâm vào lượt thứ hai:
   * "Navigation to .../login is interrupted by another navigation to .../login". Đây là cuộc
   * đua THỨ HAI, khác hẳn cuộc đua request-bị-hủy ở trên — sửa cái trước xong mới lộ ra cái này.
   *
   * ĐÃ THỬ `waitForLoadState('networkidle')` VÀ NÓ SAI: màn đăng nhập không bao giờ đứng yên
   * 500ms không-một-request, nên cả 10 bài break-glass treo tới hết 60 giây. Ghi lại đây để
   * không ai thử lại đường đó.
   *
   * Chỗ đúng để chịu đựng cuộc đua này là `fillLogin` — bên dưới — vì nó mới là nơi gọi
   * `goto`. Ở đây chỉ cần chờ trang thật sự rời khỏi màn đã đăng nhập.
   */
  await page.waitForURL(/\/login(\?|$)/);
}

/**
 * Mở drawer điều hướng ở viewport hẹp (≤900px).
 *
 * Ở 390px sidebar KHÔNG nằm sẵn trong DOM (nó ăn 60% bề ngang điện thoại), nên muốn bấm một
 * mục nav thì phải mở drawer trước. Để ở đây thay vì chép vào từng `*.mobile.spec.ts` — AD-15.
 */
export async function openNavDrawer(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Mở menu' }).click();
}

export function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

/**
 * Gõ vào ô tìm rồi CHỜ BỘ LỌC ĂN — dùng trước mọi thao tác lên dòng kết quả.
 *
 * ===== LỖ ĐANG VÁ (M-7 của rà soát 18/09/2026) =====
 *
 * Từ khi trạng thái danh sách chuyển lên thanh địa chỉ (`ui/use-list-url-state.ts`), ô tìm có
 * DEBOUNCE 250ms. Dòng cần tìm thường đã nằm sẵn trong bảng từ trước khi lọc, nên
 * `expect(row).toBeVisible()` xanh SỚM, và thao tác ngay sau đó rơi vào đúng khoảnh khắc
 * trước lượt vẽ lại: menu ba chấm vừa mở thì bảng vẽ lại và menu đóng sập, hoặc khu vừa bung
 * biến mất, còn bài kiểm đứng chờ một thứ không bao giờ tới.
 *
 * Lượt E2E đầy đủ 18/09 đỏ đúng một bài vì chuyện này (`license-assignment.spec.ts`), và bài
 * đó chạy riêng thì 3/3 xanh — tức đây là loại đỏ ngẫu nhiên, mỗi lần một chỗ khác nhau.
 *
 * ===== CHỜ BẰNG URL, KHÔNG BẰNG SỐ DÒNG =====
 *
 * Đếm dòng (`toHaveCount(2)`) chỉ đúng với màn biết trước còn đúng một kết quả, nên không
 * dùng lại được. Còn `q=` trên thanh địa chỉ là dấu hiệu CHUNG cho mọi màn đã chuyển sang
 * `useListUrlState`: nó chỉ xuất hiện khi nhịp debounce đã bắn, tức lượt gọi API mới đã đi và
 * React đã có dữ liệu để vẽ lại.
 *
 * Màn chưa dùng hook (ví dụ `/admin/accounts`) thì không có `q=` — gọi hàm này ở đó sẽ chờ vô
 * ích rồi hết giờ, nên đừng gọi. Đó cũng là một cách để biết màn nào còn đứng ngoài luật.
 */
export async function timVaChoLoc(page: Page, tuKhoa: string): Promise<void> {
  await page.getByRole('searchbox', { name: /Tìm/ }).fill(tuKhoa);
  await expect(page).toHaveURL(/[?&]q=/);
}

/**
 * Mở menu ba chấm của một dòng rồi chọn một việc trong đó (28/08/2026).
 *
 * Cột "Thao tác" của mọi bảng danh sách đã đổi từ dãy nút phẳng sang menu ba chấm
 * (`ui/row-actions.tsx`), nên `getByRole('button', { name: 'Sửa' })` không còn tìm thấy gì:
 * mục menu chỉ tồn tại trong DOM khi menu đang mở, và nó mang vai `menuitem` chứ không phải
 * `button`. Để ở đây thay vì chép hai dòng vào hai chục chỗ — AD-15.
 *
 * `subject` là thứ đứng sau "Thao tác với …" trong `aria-label` của nút ba chấm: mã hồ sơ,
 * địa chỉ IP, tên tài khoản… Nó phải RIÊNG cho từng dòng, đó chính là lý do nhãn mang nó.
 */
export async function rowAction(
  page: Page,
  subject: string | RegExp,
  action: string | RegExp,
): Promise<void> {
  const label =
    typeof subject === 'string'
      ? `Thao tác với ${subject}`
      : new RegExp(`Thao tác với .*${subject.source}`, subject.flags);
  await page.getByRole('button', { name: label }).click();
  await page.getByRole('menuitem', { name: action }).click();
}

/** Menu ba chấm của một dòng CÓ mục này không — dùng để kiểm việc bị ẩn theo quyền. */
export async function rowActionNames(page: Page, subject: string): Promise<string[]> {
  await page.getByRole('button', { name: `Thao tác với ${subject}` }).click();
  const names = await page.getByRole('menuitem').allTextContents();
  await page.keyboard.press('Escape');
  return names;
}
