#!/usr/bin/env node
/**
 * Đưa MỌI vùng dữ liệu do E2E tạo ra về trạng thái sạch — trong MỘT lần gọi.
 *
 * CHỈ dùng ở môi trường dev/CI. Không có endpoint API nào làm việc này — cố tình, để
 * production không tồn tại cửa hậu (NFR-01).
 *
 *   docker compose exec -T api node scripts/reset-e2e.mjs users devices software
 *
 * ===== VÌ SAO GỘP LÀM MỘT (07/09/2026) =====
 *
 * Trước đây `e2e/tests/helpers.ts` có 11 hàm reset, mỗi hàm tự `execSync` một lệnh
 * `docker compose exec` riêng, và mỗi `beforeEach` gọi 2-5 hàm. Đo được: **một lần
 * `docker compose exec` tốn 0,46 giây** trên máy Windows này. Nhân với ~900 lượt gọi
 * trong một lượt chạy đầy đủ là **~7 phút thuần overhead** — nhiều hơn cả thời gian
 * trình duyệt thật sự làm việc ở phần lớn các bài.
 *
 * Gộp về một script: 1 tiến trình, 1 kết nối pg, 1 transaction cho mỗi vùng. Số lần
 * `exec` trong cả bộ giảm từ ~900 xuống ~264 (đúng một lần mỗi bài).
 *
 * Lợi thứ hai, không kém phần quan trọng: 7 hàm cũ tắt trigger append-only bằng
 * `ALTER TABLE ... DISABLE TRIGGER` rồi bật lại ở câu SQL kế tiếp, KHÔNG có `try/finally`.
 * Một lỗi FK giữa chừng là trigger ở lại DISABLED, và từ lúc đó hai bài kiểm giữ NFR-03
 * (`audit-log.spec.ts`, `ip-lifecycle.spec.ts`) cho kết quả GIẢ mà không ai biết
 * (rà soát 07/09). Ở đây mỗi vùng chạy trong một transaction: hỏng thì `ROLLBACK` trả
 * trigger về nguyên trạng.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { hash } from '@node-rs/argon2';
import pg from 'pg';

const ARGON = { algorithm: 2, memoryCost: 65_536, timeCost: 3, parallelism: 1 };

const E2E_USERS = [
  { email: 'e2e-sa@pmh.com.vn', fullName: 'E2E Super Admin', role: 'sa', password: 'E2e@Test#2026' },
  {
    email: 'e2e-member@pmh.com.vn',
    fullName: 'E2E Thành viên',
    role: 'member',
    password: 'E2e@Test#2026',
  },
];

/** Trần đăng nhập/IP mà cả bộ E2E chạy dưới — phải khớp `E2E_LOGIN_RATE_LIMIT` bên helpers. */
const E2E_LOGIN_RATE_LIMIT = 500;

/**
 * Mỗi vùng = một danh sách câu SQL chạy TRONG MỘT transaction.
 *
 * Quy ước xuyên suốt: chỉ đụng dữ liệu mang dấu E2E (`code ILIKE '%E2E%'`,
 * `name ILIKE '%E2E%'`, `email LIKE 'e2e-tao-moi-%'`). Không câu nào có thể chạm dữ liệu
 * thật của PMH trong stack dev.
 *
 * ===== THỨ TỰ KHAI Ở ĐÂY CHÍNH LÀ THỨ TỰ DỌN =====
 *
 * `all` chạy các vùng theo đúng thứ tự khai trong object này, nên vùng nào bị vùng khác TRỎ
 * TỚI thì phải nằm SAU. Cụ thể: `catalog` (site · tủ · nhà cung cấp · loại thiết bị · cổng
 * dịch vụ · phòng ban · nhà mạng) là thứ MỌI vùng khác trỏ vào, nên nó phải là vùng CUỐI.
 *
 * Trước 17/09 `catalog` nằm giữa danh sách, ngay trước `isp`. Chạy được suốt vì các bài ISP
 * của bộ E2E không gắn đường truyền vào site E2E nào. Nhưng gieo một lô dữ liệu thử có gắn
 * — đúng cảnh dùng thật — là `DELETE FROM site` đâm vào `isp_line_site_id_fkey`, cả vùng
 * `catalog` ROLLBACK, và cửa canh rác ở `e2e/global-teardown.ts` đỏ ở CUỐI lượt chạy với một
 * thông báo khoá ngoại chẳng liên quan gì tới bài vừa chạy.
 */
const DOMAINS = {
  /** Tài khoản do bài "SA tạo tài khoản mới" đẻ ra + trần đăng nhập cho môi trường test. */
  users: [
    `UPDATE system_config SET value = '${E2E_LOGIN_RATE_LIMIT}' WHERE key = 'login.rate_limit_per_ip'`,
    `DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'e2e-tao-moi-%')`,
    `DELETE FROM known_device WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'e2e-tao-moi-%')`,
    `DELETE FROM users WHERE email LIKE 'e2e-tao-moi-%'`,
  ],

  devices: [
    `DELETE FROM file WHERE owner_type = 'device' AND owner_id IN (SELECT id FROM device WHERE code ILIKE '%E2E%')`,
    `DELETE FROM secret WHERE owner_type = 'device' AND owner_id IN (SELECT id FROM device WHERE code ILIKE '%E2E%')`,
    `DELETE FROM file WHERE owner_type = 'nat_rule' AND owner_id IN (SELECT id FROM nat_rule WHERE device_id IN (SELECT id FROM device WHERE code ILIKE '%E2E%'))`,
    `DELETE FROM license_assignment WHERE device_id IN (SELECT id FROM device WHERE code ILIKE '%E2E%')`,
    `UPDATE isp_line SET device_id = NULL WHERE device_id IN (SELECT id FROM device WHERE code ILIKE '%E2E%')`,
    `ALTER TABLE nat_rule_history DISABLE TRIGGER nat_rule_history_no_delete`,
    `DELETE FROM nat_rule_history WHERE nat_rule_id IN (SELECT id FROM nat_rule WHERE device_id IN (SELECT id FROM device WHERE code ILIKE '%E2E%'))`,
    `ALTER TABLE nat_rule_history ENABLE TRIGGER nat_rule_history_no_delete`,
    `DELETE FROM nat_rule WHERE device_id IN (SELECT id FROM device WHERE code ILIKE '%E2E%')`,
    `ALTER TABLE ip_history DISABLE TRIGGER ip_history_no_delete`,
    `DELETE FROM ip_history WHERE ip_address_id IN (SELECT id FROM ip_address WHERE device_id IN (SELECT id FROM device WHERE code ILIKE '%E2E%'))`,
    `ALTER TABLE ip_history ENABLE TRIGGER ip_history_no_delete`,
    `DELETE FROM ip_address WHERE device_id IN (SELECT id FROM device WHERE code ILIKE '%E2E%')`,
    `DELETE FROM device_port WHERE device_id IN (SELECT id FROM device WHERE code ILIKE '%E2E%') OR connected_device_id IN (SELECT id FROM device WHERE code ILIKE '%E2E%')`,
    `ALTER TABLE device_history DISABLE TRIGGER device_history_no_delete`,
    `DELETE FROM device_history WHERE device_id IN (SELECT id FROM device WHERE code ILIKE '%E2E%')`,
    `ALTER TABLE device_history ENABLE TRIGGER device_history_no_delete`,
    `DELETE FROM device WHERE code ILIKE '%E2E%'`,
  ],

  software: [
    // Giấy tờ của hồ sơ phần mềm chưa từng nằm trong vùng nào — 70 hàng mồ côi (cửa canh 11/09).
    `DELETE FROM file WHERE owner_type = 'software' AND owner_id IN (SELECT id FROM software WHERE code ILIKE '%E2E%')`,
    `DELETE FROM license_assignment WHERE software_id IN (SELECT id FROM software WHERE code ILIKE '%E2E%')`,
    `DELETE FROM secret WHERE owner_type = 'software' AND owner_id IN (SELECT id FROM software WHERE code ILIKE '%E2E%')`,
    `ALTER TABLE software_history DISABLE TRIGGER software_history_no_delete`,
    `DELETE FROM software_history WHERE software_id IN (SELECT id FROM software WHERE code ILIKE '%E2E%')`,
    `ALTER TABLE software_history ENABLE TRIGGER software_history_no_delete`,
    `DELETE FROM software WHERE code ILIKE '%E2E%'`,
  ],

  ipam: [
    // Giấy tờ của dải và của rule NAT: 54 hàng mồ côi nữa, cùng lý do (cửa canh 11/09).
    `DELETE FROM file WHERE owner_type = 'subnet' AND owner_id IN (SELECT id FROM subnet WHERE name ILIKE '%E2E%')`,
    `DELETE FROM file WHERE owner_type = 'nat_rule' AND owner_id IN (SELECT id FROM nat_rule WHERE ip_address_id IN (SELECT id FROM ip_address WHERE subnet_id IN (SELECT id FROM subnet WHERE name ILIKE '%E2E%')) OR device_id IN (SELECT id FROM device WHERE code ILIKE '%E2E%'))`,
    `ALTER TABLE ip_history DISABLE TRIGGER ip_history_no_delete`,
    `DELETE FROM ip_history WHERE ip_address_id IN (SELECT id FROM ip_address WHERE subnet_id IN (SELECT id FROM subnet WHERE name ILIKE '%E2E%'))`,
    `ALTER TABLE ip_history ENABLE TRIGGER ip_history_no_delete`,
    `ALTER TABLE nat_rule_history DISABLE TRIGGER nat_rule_history_no_delete`,
    `DELETE FROM nat_rule_history WHERE nat_rule_id IN (SELECT id FROM nat_rule WHERE ip_address_id IN (SELECT id FROM ip_address WHERE subnet_id IN (SELECT id FROM subnet WHERE name ILIKE '%E2E%')) OR device_id IN (SELECT id FROM device WHERE code ILIKE '%E2E%'))`,
    `ALTER TABLE nat_rule_history ENABLE TRIGGER nat_rule_history_no_delete`,
    `DELETE FROM nat_rule WHERE ip_address_id IN (SELECT id FROM ip_address WHERE subnet_id IN (SELECT id FROM subnet WHERE name ILIKE '%E2E%'))`,
    `DELETE FROM nat_rule WHERE device_id IN (SELECT id FROM device WHERE code ILIKE '%E2E%')`,
    `DELETE FROM ip_address WHERE subnet_id IN (SELECT id FROM subnet WHERE name ILIKE '%E2E%')`,
    `DELETE FROM subnet WHERE name ILIKE '%E2E%'`,
  ],

  secrets: [`DELETE FROM secret WHERE label ILIKE '%E2E%'`],

  'service-accounts': [
    `ALTER TABLE service_account_history DISABLE TRIGGER service_account_history_no_delete`,
    `DELETE FROM secret WHERE owner_type = 'service_account' AND owner_id IN (SELECT id FROM service_account WHERE code ILIKE '%E2E%')`,
    `DELETE FROM file WHERE owner_type = 'service_account' AND owner_id IN (SELECT id FROM service_account WHERE code ILIKE '%E2E%')`,
    `DELETE FROM service_account_history WHERE service_account_id IN (SELECT id FROM service_account WHERE code ILIKE '%E2E%')`,
    `ALTER TABLE service_account_history ENABLE TRIGGER service_account_history_no_delete`,
    `DELETE FROM service_account WHERE code ILIKE '%E2E%'`,
  ],

  'access-list': [`DELETE FROM access_list WHERE member_email ILIKE '%e2e%'`],

  approvals: [
    `ALTER TABLE approval_history DISABLE TRIGGER approval_history_no_delete`,
    `DELETE FROM approval_history WHERE approval_id IN (SELECT id FROM approval WHERE requester ILIKE '%e2e%')`,
    `ALTER TABLE approval_history ENABLE TRIGGER approval_history_no_delete`,
    `DELETE FROM approval WHERE requester ILIKE '%e2e%'`,
  ],

  /*
   * Vùng này gom MỌI thứ cỗ máy hạn để lại, không chỉ luật gửi báo cáo.
   *
   * `renewal_history` (137 hàng lúc phát hiện) chưa từng nằm trong vùng nào. Nó không gắn khoá
   * ngoại với hồ sơ nào — `object_kind` + `object_id` là liên kết MỀM, cố ý, để engine hạn
   * không phải biết bảng nào tồn tại (AD-7). Nên không có hàng gốc nào để dọn theo, và nó chỉ
   * lớn lên. Lọc bằng `actor` như vùng `approvals`, cộng `label` cho chắc.
   */
  'digest-rules': [
    `ALTER TABLE renewal_history DISABLE TRIGGER renewal_history_no_delete`,
    `DELETE FROM renewal_history WHERE actor ILIKE '%e2e%' OR label ILIKE '%E2E%'`,
    `ALTER TABLE renewal_history ENABLE TRIGGER renewal_history_no_delete`,
    `DELETE FROM expiry_rule WHERE name ILIKE '%E2E%'`,
  ],

  isp: [
    /*
     * LỖ ĐÃ VÁ 12/09: migration 0036 cho `secret.owner_type` nhận thêm `isp`, và dòng `file`
     * ngay dưới được thêm cùng lúc — nhưng `secret` thì không. Ba loại chủ thể kia đều có
     * dòng dọn secret của mình (`device` ở dòng 66, `software` 89, `service_account` 152);
     * đường truyền đứng ngoài suốt.
     *
     * Hậu quả không phải rác nằm im: một ngăn két cất vào đường truyền E2E sống sót qua trọn
     * lượt dọn, và `e2e/leak-guard.ts` làm ĐỎ cả lượt chạy — đúng như nó đã làm hôm nay, với
     * một dòng `secret` owner_type='isp' duy nhất.
     *
     * PHẢI đứng TRƯỚC `DELETE FROM isp_line` bên dưới: xoá hồ sơ trước thì truy vấn con này
     * không còn gì để khớp, và ngăn két thành mồ côi — không lượt dọn nào với tới nữa.
     */
    `DELETE FROM secret WHERE owner_type = 'isp' AND owner_id IN (SELECT id FROM isp_line WHERE code ILIKE '%E2E%')`,
    `DELETE FROM file WHERE owner_type = 'isp' AND owner_id IN (SELECT id FROM isp_line WHERE code ILIKE '%E2E%')`,
    `ALTER TABLE isp_line_history DISABLE TRIGGER isp_line_history_no_delete`,
    `DELETE FROM isp_line_history WHERE isp_line_id IN (SELECT id FROM isp_line WHERE code ILIKE '%E2E%')`,
    `ALTER TABLE isp_line_history ENABLE TRIGGER isp_line_history_no_delete`,
    `DELETE FROM isp_line WHERE code ILIKE '%E2E%'`,
  ],

  /*
   * PHẢI LÀ VÙNG CUỐI CÙNG — xem chú thích ngay trên `DOMAINS`.
   *
   * QUY ƯỚC: tên CHỨA chữ "E2E", không phải BẮT ĐẦU bằng "E2E-".
   *
   * Ba dòng `site`/`vendor`/`device_type` trước 11/09 dùng `LIKE 'E2E-%'` — khác hẳn sáu vùng
   * còn lại, và khác vì một lý do không ai nhớ. Hậu quả đo được: spec đặt tên `S-E2E-MIXA-…`
   * (có tiền tố `S-`) nên không bao giờ bị dọn, và `cabinet` của nó ở lại theo. Cửa canh rác
   * 11/09 tìm ra — đúng lớp lỗi "hai bản luật cho cùng một khái niệm".
   *
   * `catalog_history` cũng chưa từng được dọn: 793 hàng tích lại. Nó là bảng chỉ-thêm (AD-13)
   * nên phải tắt trigger đúng như sáu bảng lịch sử khác trong file này.
   */
  catalog: [
    `ALTER TABLE catalog_history DISABLE TRIGGER catalog_history_no_delete`,
    /*
     * Hai vế, và vế thứ hai mới là vế bắt buộc.
     *
     * Danh mục XOÁ HẲN được qua API (không phải ẩn), còn lịch sử thì ở lại — đó là thiết kế:
     * dòng "đã xoá" là thứ duy nhất còn chứng minh mục đó từng tồn tại. Hệ quả với E2E: hàng
     * lịch sử MỒ CÔI, không còn hàng gốc nào để dọn theo, nên vế `entity_id IN (…)` không bao
     * giờ với tới.
     *
     * Lọc theo NGƯỜI THỰC HIỆN là cách vùng `approvals` ngay dưới đã dùng (`requester ILIKE
     * '%e2e%'`) — không phải quy ước mới, và không đụng tới lịch sử của người dùng thật (năm
     * tài khoản thật không ai có chữ "e2e" trong email).
     */
    `DELETE FROM catalog_history WHERE actor ILIKE '%e2e%' OR entity_id IN (SELECT id FROM site WHERE code ILIKE '%E2E%' UNION ALL SELECT id FROM cabinet WHERE code ILIKE '%E2E%' UNION ALL SELECT id FROM vendor WHERE name ILIKE '%E2E%' UNION ALL SELECT id FROM device_type WHERE name ILIKE '%E2E%' UNION ALL SELECT id FROM service_port WHERE name ILIKE '%E2E%' UNION ALL SELECT id FROM department WHERE name ILIKE '%E2E%' UNION ALL SELECT id FROM isp_provider WHERE name ILIKE '%E2E%')`,
    `ALTER TABLE catalog_history ENABLE TRIGGER catalog_history_no_delete`,
    `DELETE FROM cabinet WHERE code ILIKE '%E2E%' OR site_id IN (SELECT id FROM site WHERE code ILIKE '%E2E%')`,
    `DELETE FROM site WHERE code ILIKE '%E2E%'`,
    `DELETE FROM vendor WHERE name ILIKE '%E2E%'`,
    `DELETE FROM device_type WHERE name ILIKE '%E2E%'`,
    `DELETE FROM service_port WHERE name ILIKE '%E2E%'`,
    `DELETE FROM department WHERE name ILIKE '%E2E%'`,
    `DELETE FROM isp_provider WHERE name ILIKE '%E2E%'`,
  ],
};

/**
 * Băm Argon2 tốn ~200-400ms MỖI tài khoản, và script này chạy lại ở mọi `beforeEach` —
 * tức 2 lần băm × 264 bài = 2-3,5 phút thuần băm cho một lượt chạy đầy đủ.
 *
 * Argon2 sinh salt ngẫu nhiên mỗi lần, nhưng MỘT băm cũ của cùng mật khẩu vẫn xác thực đúng
 * — nên dùng lại được. Cache trong container (`/tmp`, mất khi container dựng lại, đúng ý:
 * pepper đổi thì cache cũng phải đi theo).
 *
 * Khóa cache gồm cả pepper để đổi pepper là cache tự hỏng, không âm thầm dùng băm sai.
 */
const HASH_CACHE = '/tmp/.e2e-argon2-cache.json';

function loadHashCache() {
  try {
    return JSON.parse(readFileSync(HASH_CACHE, 'utf8'));
  } catch {
    return {};
  }
}

/** Đưa hai tài khoản E2E cố định về trạng thái "vừa được SA tạo". */
async function resetUsers(pool) {
  const pepper = readFileSync(process.env.PASSWORD_PEPPER_FILE, 'utf8').trim();
  const cache = loadHashCache();
  const cacheKey = (user) => `${user.email}|${createHash('sha256').update(pepper).digest('hex')}`;
  let cacheDirty = false;

  for (const user of E2E_USERS) {
    const key = cacheKey(user);
    let passwordHash = cache[key];
    if (!passwordHash) {
      passwordHash = await hash(`${user.password}${pepper}`, ARGON);
      cache[key] = passwordHash;
      cacheDirty = true;
    }
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [user.email]);
    if (existing.rowCount > 0) {
      const id = existing.rows[0].id;
      await pool.query(
        `UPDATE users SET password_hash=$2, must_change_password=true, status='active',
           failed_attempts=0, locked_until=NULL, totp_secret_ct=NULL, totp_secret_iv=NULL,
           totp_secret_tag=NULL, totp_dek_wrapped=NULL, totp_key_version=NULL,
           totp_enrolled_at=NULL, totp_last_timestep=NULL, totp_login_required=true,
           updated_at=now()
         WHERE id=$1`,
        [id, passwordHash],
      );
      await pool.query(
        `UPDATE sessions SET revoked_at=now(), revoked_reason='e2e-reset'
         WHERE user_id=$1 AND revoked_at IS NULL`,
        [id],
      );
      await pool.query('DELETE FROM known_device WHERE user_id=$1', [id]);
      /*
       * Bộ đếm gõ sai theo CẶP (người dùng, IP) — bảng thêm 11/09.
       *
       * Phải dọn ở đây, cạnh `failed_attempts=0` ngay trên: từ 11/09 chính bảng này mới là thứ
       * CHẶN đăng nhập, còn hai cột kia chỉ còn vai cảnh báo. Bỏ sót nó thì một bài kiểm khoá
       * tài khoản để lại hàng khoá cho bài kế tiếp, và bài kế tiếp đỏ vì một lý do chẳng liên
       * quan gì tới nó — đúng kiểu rò rỉ mà `e2e/leak-guard.ts` được dựng lên để bắt.
       */
      await pool.query('DELETE FROM login_failure WHERE user_id=$1', [id]);
    } else {
      await pool.query(
        `INSERT INTO users (email, full_name, role, password_hash, must_change_password, totp_login_required)
         VALUES ($1,$2,$3,$4,true,true)`,
        [user.email, user.fullName, user.role, passwordHash],
      );
    }
  }

  // Ghi cache SAU vòng lặp, một lần. Hỏng thì kệ — lần sau băm lại, chỉ chậm chứ không sai.
  if (cacheDirty) {
    try {
      writeFileSync(HASH_CACHE, JSON.stringify(cache), 'utf8');
    } catch {
      /* không ghi được cache thì thôi, không phải lỗi nghiệp vụ */
    }
  }
}

async function main() {
  /*
   * CHẶN THẬT, không chỉ cảnh báo: script này đặt lại mật khẩu về một chuỗi có sẵn trong repo
   * và hủy mọi phiên đang mở. Chạy nhầm trên máy thật là mở toang cửa. Muốn chạy thì phải khai
   * tường minh ALLOW_E2E_RESET=1 (chỉ môi trường test/CI mới đặt biến này).
   */
  if (process.env.ALLOW_E2E_RESET !== '1') {
    console.error(
      'Từ chối chạy: script chỉ dành cho môi trường test. ' +
        'Nếu đây đúng là máy test, chạy lại với ALLOW_E2E_RESET=1.',
    );
    process.exit(1);
  }

  /*
   * `all` = mọi vùng, theo đúng thứ tự khai trong `DOMAINS`.
   *
   * Thêm 11/09 cho cửa canh rác ở `e2e/global-teardown.ts`: nó chạy trọn lượt dọn ở cuối lượt
   * E2E rồi hỏi "còn sót hàng nào không". Thứ sống sót qua lượt dọn thì THEO ĐỊNH NGHĨA là
   * thứ lượt dọn không dọn được — không phải đoán, không phải chép lại luật ra chỗ thứ hai.
   *
   * Gõ tay 12 tên vùng ở bên kia cũng chạy, nhưng đó lại là một danh sách nữa phải nhớ cập
   * nhật, và quên cập nhật thì cửa canh mù đúng vùng vừa thêm.
   */
  const requested = process.argv.slice(2);
  /*
   * SẮP LẠI THEO THỨ TỰ KHAI CỦA `DOMAINS`, KHÔNG THEO THỨ TỰ THAM SỐ (18/09/2026).
   *
   * Banner ở đầu file tuyên bố "THỨ TỰ KHAI Ở ĐÂY CHÍNH LÀ THỨ TỰ DỌN", và điều đó chỉ đúng
   * với `all`. Mọi `beforeEach` bên E2E gọi `flushResets()`, mà hàm đó truyền tên vùng theo
   * `DOMAIN_ORDER` trong `e2e/tests/helpers.ts` — một mảng có thứ tự KHÁC HẲN (`devices` đứng
   * thứ 9 thay vì thứ 2). Tức là có HAI bản luật cho cùng một khái niệm, đúng thứ chính file
   * này lên án ở đoạn dưới.
   *
   * Hiện chưa nổ vì `catalog` tình cờ cũng nằm cuối `DOMAIN_ORDER` — mà `catalog` phải cuối
   * chính là bất biến quan trọng nhất ở đây. Một lần sắp lại mảng bên kia là hỏng, và hỏng
   * dưới dạng lỗi khoá ngoại ở một bài chẳng liên quan.
   *
   * Sắp ở ĐÂY thì thứ tự tham số thôi có nghĩa, và nơi gọi không cần nhớ luật nào cả.
   */
  /* `users` ĐÃ là khoá đầu của `DOMAINS`, nên `['users', ...keys]` đếm nó hai lần và lượt
     `all` chạy vùng ấy hai lượt (vô hại vì các câu đều idempotent, nhưng là một mâu thuẫn
     hiển hiện với banner). Lọc ra — sửa 19/09/2026. */
  const order = ['users', ...Object.keys(DOMAINS).filter((d) => d !== 'users')];
  const domains = (requested.includes('all') ? order : requested)
    .slice()
    .sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const unknown = domains.filter((d) => d !== 'users' && !(d in DOMAINS));
  if (unknown.length > 0) {
    console.error(
      `Vùng không hợp lệ: ${unknown.join(', ')}. Hợp lệ: users, ${Object.keys(DOMAINS).join(', ')}`,
    );
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    if (domains.includes('users')) await resetUsers(pool);

    for (const domain of domains) {
      const statements = DOMAINS[domain];
      if (!statements) continue;
      /*
       * MỘT transaction cho mỗi vùng. `ROLLBACK` trong `catch` là thứ trả lại trigger
       * append-only khi có câu nào hỏng giữa chừng — không có nó thì `ALTER TABLE ...
       * DISABLE TRIGGER` ở đầu danh sách nằm lại vĩnh viễn và hàng rào AD-13 im lặng biến mất.
       */
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (const sql of statements) await client.query(sql);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw new Error(`reset vùng "${domain}" thất bại: ${error.message}`);
      } finally {
        client.release();
      }
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Reset E2E thất bại:', error.message);
  process.exit(1);
});
