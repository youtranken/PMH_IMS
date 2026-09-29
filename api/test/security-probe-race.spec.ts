import { runMigrations } from '../src/database/migration-runner';
import { SecurityProbeService } from '../src/modules/audit/security-probe.service';
import { OutboxService } from '../src/modules/outbox/outbox.service';
import { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import type { SystemConfigService } from '../src/modules/config-sys/system-config.service';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * CẢNH BÁO DÒ KÉT CHỈ ĐƯỢC ĐI MỘT LÁ, KỂ CẢ KHI BỊ BẮN SONG SONG.
 *
 * ===== LỖ ĐANG VÁ =====
 *
 * `SecurityProbeService.noteFailure` đọc "đã cảnh báo cho người này chưa" rồi mới mở
 * transaction để ghi vết + đẩy thư. Tới 18/09/2026 phép đọc ấy nằm NGOÀI transaction và
 * không khóa gì theo người, nên giữa lượt đọc và lượt ghi có một khe hở:
 *
 *     T1 đọc "chưa cảnh báo"  →  T2 đọc "chưa cảnh báo"  →  T1 ghi  →  T2 ghi
 *
 * Trần của cửa mở ngăn là 30 lượt/phút cho mỗi người, và một Member không có quyền gì trên
 * két vẫn bắn được đủ 30 lượt ấy SONG SONG. Cả 30 đều 403, cả 30 đều gọi vào đây, cả 30 đều
 * đọc thấy "chưa cảnh báo" → 30 lá thư tới mọi SA và Admin trong một nhịp, lặp lại sau mỗi
 * 60 phút. Tức là chính cái cảnh báo trở thành công cụ làm ngập hộp thư — đúng thứ mà chú
 * thích "VÌ SAO CÓ THỜI GIAN NGHỈ" ở đầu service tuyên bố đã chặn được.
 *
 * ===== VÌ SAO PHẢI Ở TẦNG NÀY =====
 *
 * Bài đơn vị không hỏi được: cấm mock drizzle, mà mock thì cũng không có bộ quản lý khóa của
 * Postgres để đo. E2E cũng không: bài `vault.spec.ts` bắn SÁU lượt TUẦN TỰ, nên nó đi qua
 * đúng nhánh mà lỗi này không sống — nó xanh cả trước lẫn sau bản vá. Chỉ nhiều kết nối thật
 * cùng lao vào một lúc mới dựng lại được khe hở.
 *
 * ===== ĐỘT BIẾN BÀI NÀY GIẾT =====
 *
 * Bỏ `pg_advisory_xact_lock`, hoặc kéo phép đếm `alerted` ra ngoài `db.transaction` — cả hai
 * đều làm bài này đỏ với số lá thư lớn hơn 1. Đã thử tay cả hai trước khi commit.
 */

const TEST_TIMEOUT = 120_000;
/** Bắn bao nhiêu lượt cùng lúc — đúng trần mặc định `rate.secret_reveal_per_minute` của cửa mở ngăn. */
const SO_LUOT_SONG_SONG = 30;

/**
 * MỖI BÀI MỘT NGƯỜI RIÊNG, thay cho `TRUNCATE` giữa các bài.
 *
 * `audit_log` là bảng chỉ-thêm và có hàng rào DB chặn thẳng `TRUNCATE` (NFR-03/AD-13) — đúng
 * luật, và bài kiểm không được phép là ngoại lệ của chính luật nó đang canh. Mọi phép đếm ở
 * dưới vì thế đều lọc theo `actor`, y như service làm.
 */
let dem = 0;
const nguoiMoi = (): string => `ke-do-ket-${Date.now().toString(36)}-${++dem}@pmh.com.vn`;

/** Bản cấu hình cố định: bài này hỏi về ĐUA, không hỏi về việc đọc `system_config`. */
const config = {
  getNumber: (name: string): Promise<number> => {
    if (name === 'secretProbeAlertThreshold') return Promise.resolve(3);
    if (name === 'secretProbeWindowMinutes') return Promise.resolve(15);
    if (name === 'secretProbeCooldownMinutes') return Promise.resolve(60);
    if (name === 'secretProbeEscalationMultiplier') return Promise.resolve(3);
    return Promise.reject(new Error(`Khóa cấu hình lạ trong bài kiểm: ${name}`));
  },
} as unknown as SystemConfigService;

describe('Cảnh báo dò két không nhân lên khi bị bắn song song', () => {
  let scratch: ScratchDb;
  let probe: SecurityProbeService;

  beforeAll(async () => {
    scratch = await createScratchDb('ims_probe');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    probe = new SecurityProbeService(
      scratch.db,
      config,
      new OutboxService(scratch.db),
      new AuditWriterService(scratch.db),
    );
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  /** Đưa một người lên ĐÚNG ngưỡng: ba lượt thất bại đã nằm trong cửa sổ 15 phút. Dùng cả hai
      loại hành động vì service đếm CHUNG — tách hai bộ đếm thì kẻ dò chỉ cần xen kẽ. */
  const gieoNguongCho = async (actor: string): Promise<void> => {
    await scratch.pool.query(
      `INSERT INTO audit_log (actor, action, object_type, object_id, detail)
       VALUES ($1, 'vault.secret.reveal_denied', 'secret', NULL, '{}'::jsonb),
              ($1, 'vault.secret.reveal_denied', 'secret', NULL, '{}'::jsonb),
              ($1, 'auth.stepup.failed',         'session', NULL, '{}'::jsonb)`,
      [actor],
    );
  };

  const demCanhBao = async (actor: string): Promise<number> => {
    const { rows } = await scratch.pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit_log
        WHERE actor = $1 AND action = 'security.probe.alerted'`,
      [actor],
    );
    return rows[0].n;
  };

  const demThu = async (actor: string): Promise<number> => {
    const { rows } = await scratch.pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM outbox
        WHERE topic = 'security.probe.alert' AND payload->>'who' = $1`,
      [actor],
    );
    return rows[0].n;
  };

  it(
    `${SO_LUOT_SONG_SONG} lượt thất bại bắn CÙNG LÚC chỉ sinh ra ĐÚNG MỘT lá thư`,
    async () => {
      const actor = nguoiMoi();
      await gieoNguongCho(actor);

      await Promise.all(
        Array.from({ length: SO_LUOT_SONG_SONG }, () => probe.noteFailure(actor)),
      );

      // Đếm dòng vết, không đếm thư trong hộp: vết commit đồng bộ ngay trong lượt gọi, còn
      // thư đi qua outbox → BullMQ → SMTP bất đồng bộ, hỏi nó là hỏi một cuộc đua khác.
      expect(await demCanhBao(actor)).toBe(1);
      expect(await demThu(actor)).toBe(1);

      /*
       * KHÔNG khẳng định cột `ip` ở ĐÂY — và đây là lý do, ghi ra để lần sau khỏi thử lại.
       *
       * Lý do duy nhất để đổi `tx.insert` sang `appendWithin` là cột `ip`, vì chỉ đường kia mới
       * chạy `toRow()` (`audit-writer.service.ts:83`). Nhưng `toRow()` lấy `ip` từ
       * `currentRequestIp()`, mà bài này dựng service bằng tay NGOÀI ngữ cảnh request — nên
       * `ip` là NULL ở cả hai đường, không phân biệt được. Mọi cột còn lại (`objectType`,
       * `detail`, …) đều do nơi gọi truyền vào, nên một `tx.insert` gõ tay vẫn điền đúng.
       *
       * Thử ngày 19/09: gieo đột biến quay về `tx.insert` — bài vẫn xanh, đúng như suy luận.
       * Phép kiểm cho cột `ip` vì thế nằm ở `e2e/tests/vault.spec.ts`, nơi lượt gọi đi qua
       * controller thật trong một request thật.
       */
    },
    TEST_TIMEOUT,
  );

  it(
    'thời gian nghỉ vẫn chặn lượt sau, và vết của nó ở CÙNG transaction với thư',
    async () => {
      const actor = nguoiMoi();
      await gieoNguongCho(actor);

      await probe.noteFailure(actor);
      expect(await demCanhBao(actor)).toBe(1);
      expect(await demThu(actor)).toBe(1);

      // Lượt thứ hai rơi trọn trong 60 phút nghỉ → không thêm gì cả.
      await probe.noteFailure(actor);
      expect(await demCanhBao(actor)).toBe(1);
      expect(await demThu(actor)).toBe(1);

      /* Vết và thư luôn đi CÙNG NHAU (AD-5). Lệch số là đã có một nhánh commit riêng —
         hoặc thư đi mà không có vết (lần sau gửi tiếp, vì nghỉ đọc từ chính vết ấy), hoặc
         có vết mà thư bị nuốt và không ai biết. */
      expect(await demCanhBao(actor)).toBe(await demThu(actor));
    },
    TEST_TIMEOUT,
  );

  it(
    'hai người khác nhau không chặn cảnh báo của nhau',
    async () => {
      const mot = nguoiMoi();
      const hai = nguoiMoi();
      await gieoNguongCho(mot);
      await gieoNguongCho(hai);

      /* Khóa băm từ `actor`, nên hai người phải đi song song được. Bài này canh chiều ngược
         của bản vá: siết quá tay (một khóa CHUNG cho cả hệ thống, hoặc phép đếm nghỉ quên
         lọc theo người) thì người thứ hai mất cảnh báo — im lặng và không ai biết. */
      await Promise.all([probe.noteFailure(mot), probe.noteFailure(hai)]);

      expect(await demCanhBao(mot)).toBe(1);
      expect(await demCanhBao(hai)).toBe(1);
      expect(await demThu(mot)).toBe(1);
      expect(await demThu(hai)).toBe(1);

      /*
       * BÀI NÀY CHỈ CHỨNG MINH ĐƯỢC NỬA SAU CỦA LỜI HỨA — nói thẳng ra, 19/09/2026.
       *
       * Bốn khẳng định trên bắt được cảnh "phép đếm thời gian nghỉ quên lọc theo người". Chúng
       * KHÔNG bắt được cảnh "khoá bị siết thành một khoá CHUNG cho cả hệ thống": khi ấy hai
       * transaction chạy nối tiếp thay vì song song, nhưng phép đếm đã lọc theo `actor` nên T1
       * vẫn đếm 0 cho `mot`, T2 vẫn đếm 0 cho `hai`, và cả bốn `toBe(1)` vẫn xanh. Chuyên gia DB
       * của lượt rà 19/09 suy ra tất định; tôi gieo `pg_advisory_xact_lock(1, 1)` và xác nhận.
       *
       * Đã thử một bài đo độ song song (giữ một transaction mở với khoá của `mot`, rồi xem lượt
       * của người thứ ba có phải chờ không) và nó KHÔNG hiệu lực: bài phải tự dựng khoá theo
       * đúng công thức của code, nên đột biến đổi công thức làm hai bên thôi đụng nhau và bài
       * lại xanh. Muốn canh thật thì phải đo từ `pg_stat_activity` trong lúc `noteFailure` đang
       * chạy — một bài riêng, không nhét vào đây.
       *
       * Ghi ra thay vì để trống: một lời hứa không ai canh mà KHÔNG ai biết là không được canh
       * thì tệ hơn hẳn một lời hứa được ghi rõ là chưa canh.
       */
    },
    TEST_TIMEOUT,
  );
});
