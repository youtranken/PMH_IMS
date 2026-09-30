import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, asc, count, eq, isNull, max, min } from 'drizzle-orm';
import { DRIZZLE_DB } from '../../database/database.module';
import type { Database } from '../../database/database.module';
import { EnvelopeCryptoService } from '../../common/crypto/envelope.service';
import type { SealedValue } from '../../common/crypto/envelope.types';
import { conflictOnUnique } from '../../common/sql';
import { noteContainsSecret, noteLooksLikeSecret } from '../../common/note-secret';
import { AuditWriterService } from '../audit/audit-writer.service';
import { OwnerExistsRegistry } from '../../common/owner-exists.registry';
import { normalizeTotpSeed, TOTP_SEED_MESSAGES } from './totp-seed';
import { secretTable } from './vault.schema';

/*
 * Có `isp` vì `file.owner_type` đã nhận đường truyền từ lâu, nên hợp đồng PDF đính vào
 * được mà mật khẩu PPPoE thì không có chỗ đứng — bất đối xứng đẩy mật khẩu thật vào ô Ghi chú
 * không mã hóa. Whitelist này có BẢN SAO ở tầng DB (`secret_owner_type_check`) và ở
 * `SecretOwnerType` bên web; thêm loại mới phải sờ đủ ba chỗ.
 */
export const SECRET_OWNER_TYPES = ['device', 'software', 'service_account', 'isp'] as const;
export type SecretOwnerType = (typeof SECRET_OWNER_TYPES)[number];

/* Bản sao ở tầng DB (`secret_kind_check`, 0035) và `SecretKind` bên web — thêm loại sửa đủ ba chỗ. */
export const SECRET_KINDS = ['password', 'license_key', 'totp', 'other'] as const;
export type SecretKind = (typeof SECRET_KINDS)[number];

/**
 * Thông tin secret KHÔNG kèm giá trị bí mật.
 *
 * Đây là thứ DUY NHẤT rời khỏi module vault khi liệt kê: tên, loại, ai cất, lúc nào.
 * Việc mở két (xem plaintext) có đường riêng, cần TOTP step-up (FR-022).
 */
export interface SecretMeta {
  id: string;
  ownerType: SecretOwnerType;
  ownerId: string;
  kind: SecretKind;
  label: string;
  username: string | null;
  note: string | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  /** Lúc giá trị đổi lần cuối và ai đổi — sửa tên gọi/ghi chú không chạm hai trường này. */
  valueChangedAt: Date;
  valueChangedBy: string;
}

export interface SecretInput {
  ownerType: SecretOwnerType;
  ownerId: string;
  kind: SecretKind;
  label: string;
  username?: string | null;
  note?: string | null;
  value: string;
}

/** Tên bảng dùng làm AAD — sai một chữ là mọi bản ghi cũ giải không ra (NFR-02). */
const AAD_TABLE = 'secret';

/**
 * Két sắt (FR-021, AD-4).
 *
 * Luật sống còn của module này:
 *  - Plaintext CHỈ tồn tại trong tham số hàm và trong bộ nhớ đúng lúc mã/giải. Không log,
 *    không audit detail, không trả về ở bất kỳ hàm nào ngoài đường "mở két" (FR-022).
 *  - KHÔNG có hàm nào trả về nhiều plaintext một lúc. FR-026 cấm tuyệt đối đường xuất
 *    toàn bộ két ở MỌI quyền — nên ở đây không tồn tại thứ để mà lỡ gọi.
 */
@Injectable()
export class VaultService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Database,
    private readonly crypto: EnvelopeCryptoService,
    private readonly audit: AuditWriterService,
    private readonly owners: OwnerExistsRegistry,
  ) {}

  /** Danh sách secret của một chủ thể — CHỈ metadata, không có giá trị. */
  async listFor(ownerType: SecretOwnerType, ownerId: string): Promise<SecretMeta[]> {
    const rows = await this.db
      .select()
      .from(secretTable)
      .where(
        and(
          eq(secretTable.ownerType, ownerType),
          eq(secretTable.ownerId, ownerId),
          isNull(secretTable.revokedAt),
        ),
      )
      .orderBy(asc(secretTable.label));
    return rows.map(toMeta);
  }

  async countFor(ownerType: SecretOwnerType, ownerId: string): Promise<number> {
    return (await this.listFor(ownerType, ownerId)).length;
  }

  /**
   * Danh sách CHỦ THỂ đang giữ secret, kèm số lượng — KHÔNG kèm tên secret, KHÔNG kèm giá trị.
   *
   * FR-026 cấm mọi đường lấy secret qua nhiều chủ thể. Hàm này cố ý dừng ở mức "máy nào /
   * hồ sơ nào có két, có mấy ngăn": nó KHÔNG chạm cột nhãn, nên kể cả bị lộ ra ngoài cũng
   * không cho biết công ty đang cất bí mật GÌ. Đủ để trang quản trị trả lời "vào phát thấy
   * hết", mà vẫn không dựng được bản đồ bí mật.
   *
   * Mở đúng một ngăn vẫn phải đi qua trang hồ sơ và gõ TOTP như cũ (4.2).
   */
  async listOwnerSummaries(): Promise<
    { ownerType: SecretOwnerType; ownerId: string; secretCount: number; lastChangeAt: Date }[]
  > {
    const rows = await this.db
      .select({
        ownerType: secretTable.ownerType,
        ownerId: secretTable.ownerId,
        secretCount: count(),
        lastChangeAt: max(secretTable.updatedAt),
      })
      .from(secretTable)
      .where(isNull(secretTable.revokedAt))
      .groupBy(secretTable.ownerType, secretTable.ownerId);

    return rows.map((row) => ({
      ownerType: row.ownerType as SecretOwnerType,
      ownerId: row.ownerId,
      secretCount: Number(row.secretCount),
      lastChangeAt: row.lastChangeAt ?? new Date(0),
    }));
  }

  /**
   * Mốc đổi giá trị CŨ NHẤT của từng hồ sơ thuộc một loại — cột "Đổi lần cuối" của danh sách
   * tài khoản dịch vụ (Q-15). Ngăn cũ nhất là ngăn kéo hồ sơ về hạn đổi. Chỉ id hồ sơ + mốc:
   * không nhãn, không loại ngăn (FR-026).
   */
  async oldestValueChangeByOwner(
    ownerType: SecretOwnerType,
  ): Promise<{ ownerId: string; valueChangedAt: Date }[]> {
    const rows = await this.db
      .select({ ownerId: secretTable.ownerId, valueChangedAt: min(secretTable.valueChangedAt) })
      .from(secretTable)
      .where(and(eq(secretTable.ownerType, ownerType), isNull(secretTable.revokedAt)))
      .groupBy(secretTable.ownerId);
    return rows
      .filter((row) => row.valueChangedAt !== null)
      .map((row) => ({ ownerId: row.ownerId, valueChangedAt: row.valueChangedAt as Date }));
  }

  async findMeta(id: string): Promise<SecretMeta> {
    return toMeta(await this.requireAlive(id));
  }

  /**
   * Cất một secret mới.
   *
   * Thứ tự BẮT BUỘC: sinh id trước → mã hóa với AAD chứa chính id đó → mới ghi. Nếu mã hóa
   * sau khi ghi thì AAD phải dùng một id chưa tồn tại, hoặc phải UPDATE lần hai — cả hai
   * đều mở ra cửa sổ có hàng chưa mã đúng ngữ cảnh.
   */
  async create(actor: string, input: SecretInput): Promise<SecretMeta> {
    if (!input.value) {
      throw new BadRequestException({
        code: 'SECRET_EMPTY',
        message: 'Chưa nhập giá trị cần cất.',
      });
    }
    const label = input.label.trim();
    if (!label) {
      throw new BadRequestException({
        code: 'FIELD_REQUIRED',
        message: 'Đặt tên gọi cho ngăn này (vd "admin web", "SSH root").',
      });
    }
    const { value, probe } = storedValue(input.kind, input.value, label, input.username);
    assertNoteHoldsNoValue(input.note, probe, 'Ghi chú đang chứa chính giá trị cần cất.');
    assertNoteLooksPlain(input.note);

    /*
     * Chủ thể phải CÓ THẬT trước khi cất bí mật vào (cùng hàng rào với kho file).
     *
     * Bí mật cất vào một `ownerId` bịa ra là bí mật KHÔNG AI MỞ LẠI ĐƯỢC — kể cả chính người
     * vừa cất: mọi đường đọc đều đi qua `listFor(ownerType, ownerId)` từ một trang hồ sơ có
     * thật. Nó nằm đó, chiếm chỗ, tính vào số đếm, và mã hóa bằng một DEK không bao giờ được
     * mở nữa.
     */
    await this.owners.assertExists(input.ownerType, input.ownerId);
    assertNoteHoldsNoValue(
      await this.owners.ownerNote(input.ownerType, input.ownerId),
      probe,
      OWNER_NOTE_HOLDS_VALUE,
    );

    const id = randomUUID();
    const sealed = this.crypto.seal(value, { table: AAD_TABLE, recordId: id });

    try {
      return await this.db.transaction(async (tx) => {
        /*
         * HỒ SƠ ĐÃ NGỪNG DÙNG THÌ KÉT ĐÓNG BĂNG.
         *
         * Trang chi tiết thiết bị có luật này (`canEdit={… && !retired}`) nhưng nó chỉ sống ở
         * MỘT màn: nếu API không chặn thì đi đường `/vault` là cất được mật khẩu mới vào một
         * cái máy đã thanh lý. Luật ở tầng ghi thì đúng ở mọi cửa.
         *
         * Nằm TRONG transaction và giữ khoá: hỏi ngoài rồi ghi trong là chừa một khoảng hở cho
         * lượt thanh lý chen vào giữa — cùng lý do mà port map, IP và license đều gọi bản
         * `…Within` (xem `DevicesService.assertUsableWithin`).
         */
        await this.owners.assertUsableWithin(tx, input.ownerType, input.ownerId);

        const rows = await tx
          .insert(secretTable)
          .values({
            id,
            ownerType: input.ownerType,
            ownerId: input.ownerId,
            kind: input.kind,
            label,
            username: input.username?.trim() || null,
            note: input.note?.trim() || null,
            valueCt: sealed.ciphertext,
            valueIv: sealed.iv,
            valueTag: sealed.tag,
            dekWrapped: sealed.wrappedDek,
            keyVersion: sealed.keyVersion,
            createdBy: actor,
            valueChangedBy: actor,
          })
          .returning();
        // Audit KHÔNG chứa giá trị, kể cả độ dài — chỉ đủ để trả lời "ai cất cái gì, lúc nào".
        await this.audit.appendWithin(tx, {
          actor,
          action: 'vault.secret.created',
          objectType: 'secret',
          objectId: id,
          detail: {
            ownerType: input.ownerType,
            ownerId: input.ownerId,
            kind: input.kind,
            label,
          },
        });
        return toMeta(rows[0]);
      });
    } catch (error) {
      throw this.translate(error, label);
    }
  }

  /** Đổi giá trị (xoay mật khẩu). Mã lại từ đầu với DEK MỚI, không dùng lại DEK cũ. */
  async rotate(actor: string, id: string, input: string): Promise<void> {
    if (!input) {
      throw new BadRequestException({
        code: 'SECRET_EMPTY',
        message: 'Chưa nhập giá trị mới.',
      });
    }
    const current = await this.requireAlive(id);
    const { value, probe } = storedValue(
      current.kind as SecretKind,
      input,
      current.label,
      current.username,
    );
    // So với ghi chú ĐANG LƯU: đây là lúc duy nhất server cầm cả hai mà không phải giải mã.
    assertNoteHoldsNoValue(
      current.note,
      probe,
      'Giá trị mới đang nằm trong ghi chú của ngăn này. Sửa ghi chú trước rồi đổi giá trị.',
    );
    assertNoteHoldsNoValue(
      await this.owners.ownerNote(current.ownerType, current.ownerId),
      probe,
      OWNER_NOTE_HOLDS_VALUE,
    );
    const sealed = this.crypto.seal(value, { table: AAD_TABLE, recordId: id });
    await this.db.transaction(async (tx) => {
      // Hồ sơ đã ngừng dùng thì két đóng băng — xem chú thích ở `create()`.
      await this.owners.assertUsableWithin(tx, current.ownerType, current.ownerId);
      requireAliveRow(
        await tx
          .update(secretTable)
          .set({
            valueCt: sealed.ciphertext,
            valueIv: sealed.iv,
            valueTag: sealed.tag,
            dekWrapped: sealed.wrappedDek,
            keyVersion: sealed.keyVersion,
            updatedAt: new Date(),
            valueChangedAt: new Date(),
            valueChangedBy: actor,
          })
          .where(aliveSecret(id))
          .returning({ id: secretTable.id }),
      );
      await this.audit.appendWithin(tx, {
        actor,
        action: 'vault.secret.rotated',
        objectType: 'secret',
        objectId: id,
      });
    });
  }

  /** Sửa phần KHÔNG bí mật (nhãn, tên đăng nhập, ghi chú) — không đụng tới ciphertext. */
  async updateMeta(
    actor: string,
    id: string,
    input: { label?: string; username?: string | null; note?: string | null },
  ): Promise<SecretMeta> {
    const before = await this.requireAlive(id);
    const values: { label?: string; username?: string | null; note?: string | null } = {};
    if (input.label !== undefined) {
      const label = input.label.trim();
      if (!label) {
        throw new BadRequestException({ code: 'FIELD_REQUIRED', message: 'Thiếu nhãn.' });
      }
      values.label = label;
    }
    if (input.username !== undefined) values.username = input.username?.trim() || null;
    if (input.note !== undefined) {
      assertNoteLooksPlain(input.note);
      values.note = input.note?.trim() || null;
    }

    try {
      return await this.db.transaction(async (tx) => {
        // Hồ sơ đã ngừng dùng thì két đóng băng — xem chú thích ở `create()`.
        await this.owners.assertUsableWithin(tx, before.ownerType, before.ownerId);
        const row = requireAliveRow(
          await tx
            .update(secretTable)
            .set({ ...values, updatedAt: new Date() })
            .where(aliveSecret(id))
            .returning(),
        );
        await this.audit.appendWithin(tx, {
          actor,
          action: 'vault.secret.updated',
          objectType: 'secret',
          objectId: id,
          detail: { label: values.label ?? before.label },
        });
        return toMeta(row);
      });
    } catch (error) {
      throw this.translate(error, values.label ?? before.label);
    }
  }

  /**
   * Thu hồi = XÓA MỀM (convention "Xóa"). Ciphertext ở lại: mật khẩu cũ vẫn cần tra khi
   * điều tra sự cố ("hôm đó ai đổi mật khẩu con switch này"), và xóa cứng thì audit ghi
   * "đã thu hồi" mà không còn gì để đối chiếu.
   */
  async revoke(actor: string, id: string): Promise<void> {
    const secret = await this.requireAlive(id);
    await this.db.transaction(async (tx) => {
      /* Hồ sơ đã ngừng dùng thì két đóng băng — kể cả THU HỒI. Nghe ngược đời, nhưng đó là
         đúng luật mà phần còn lại của hồ sơ đang theo: "mở lại mới sửa được". Cho thu hồi
         riêng lẻ thì màn `/vault` lại bày một nút chạy được cạnh ba nút bị chặn, và người
         dùng học ra một luật thứ ba. Muốn dọn thì mở lại hồ sơ, dọn, rồi thanh lý tiếp. */
      await this.owners.assertUsableWithin(tx, secret.ownerType, secret.ownerId);
      requireAliveRow(
        await tx
          .update(secretTable)
          .set({ revokedAt: new Date(), revokedBy: actor })
          .where(aliveSecret(id))
          .returning({ id: secretTable.id }),
      );
      await this.audit.appendWithin(tx, {
        actor,
        action: 'vault.secret.revoked',
        objectType: 'secret',
        objectId: id,
        detail: { label: secret.label, ownerType: secret.ownerType, ownerId: secret.ownerId },
      });
    });
  }

  /**
   * Mở két — trả về PLAINTEXT. Endpoint dẫn tới đây đòi TOTP step-up (FR-022).
   *
   * Mỗi lần gọi ghi MỘT dòng audit (NFR-03). Ghi TRƯỚC khi trả giá trị: giải mã được mà
   * mất vết thì đúng thứ két sắt sinh ra để chống.
   */
  async reveal(
    actor: string,
    id: string,
    /** Grant break-glass đã dùng. `null` = quyền đến từ vai hoặc whitelist. */
    grantId: string | null = null,
  ): Promise<{ meta: SecretMeta; value: string }> {
    const row = await this.requireAlive(id);
    const sealed: SealedValue = {
      ciphertext: row.valueCt,
      iv: row.valueIv,
      tag: row.valueTag,
      wrappedDek: row.dekWrapped,
      keyVersion: row.keyVersion,
    };
    await this.audit.append({
      actor,
      action: 'vault.secret.revealed',
      objectType: 'secret',
      objectId: id,
      detail: {
        label: row.label,
        ownerType: row.ownerType,
        ownerId: row.ownerId,
        // FR-025: xem bằng quyền nào. Thiếu trường này thì nhật ký break-glass chỉ nói
        // "có người xem" mà không nói được là xem hợp lệ theo grant nào.
        grantId,
      },
    });
    const value = this.crypto.openText(sealed, { table: AAD_TABLE, recordId: id });
    return { meta: toMeta(row), value };
  }

  private async requireAlive(id: string): Promise<typeof secretTable.$inferSelect> {
    return requireAliveRow(await this.db.select().from(secretTable).where(aliveSecret(id)));
  }

  private translate(error: unknown, label: string): unknown {
    return conflictOnUnique(error, {
      code: 'SECRET_LABEL_TAKEN',
      message: `Két này đã có ngăn tên "${label}". Đổi nhãn hoặc thu hồi cái cũ trước.`,
    });
  }
}

/**
 * "Secret này còn hiệu lực" — đi cùng MỌI câu ghi, không chỉ câu đọc mở đầu.
 *
 * Câu đọc ở đầu mỗi hàm chạy ngoài transaction. Không mang điều kiện này vào câu UPDATE thì
 * một lượt thu hồi commit vào giữa vẫn bị xoay mật khẩu / sửa nhãn đè lên, và lượt thu hồi
 * thứ hai ghi đè "ai thu hồi" của lượt đầu. Postgres đánh giá lại `WHERE` sau khi chờ khóa
 * hàng, nên lượt đến sau khớp 0 hàng thay vì ghi.
 */
function aliveSecret(id: string) {
  return and(eq(secretTable.id, id), isNull(secretTable.revokedAt));
}

/**
 * Chuỗi thật sự đem đi mã hoá, và phần cần so với ghi chú (FR-035).
 *
 * Ngăn "Mã 2 lớp" cất URI `otpauth://` chuẩn hoá (Q-18) nên thứ phải cấm trong ghi chú là KHOÁ
 * base32 bên trong nó: ghi chú chứa khoá là lộ cả mã 2 lớp dù không ai chép nguyên URI.
 * Khoá hay được chép theo nhóm có gạch nối ("JBSW-Y3DP-…"), nên ghi chú bỏ gạch nối trước khi
 * so. Thông báo lỗi không nhắc lại khoá — cùng luật với ghi chú.
 */
function storedValue(
  kind: SecretKind,
  input: string,
  label: string,
  username: string | null | undefined,
): { value: string; probe: NoteProbe } {
  if (kind !== 'totp') return { value: input, probe: { value: input, strip: null } };
  const normalized = normalizeTotpSeed(input, { label, username });
  if (normalized.value === null || normalized.secret === null) {
    throw new BadRequestException({
      code: 'TOTP_SEED_INVALID',
      message: TOTP_SEED_MESSAGES[normalized.reason ?? 'BAD_SECRET'],
    });
  }
  return { value: normalized.value, probe: { value: normalized.secret, strip: /-/g } };
}

/**
 * Ghi chú của HỒ SƠ chủ thể (vd tài khoản dịch vụ) cũng là cột rõ: form thêm hồ sơ lưu nó trước
 * rồi mới cất mật khẩu, nên chỉ két cầm được cả hai để so (FR-035).
 */
const OWNER_NOTE_HOLDS_VALUE =
  'Ghi chú của hồ sơ đang chứa chính giá trị cần cất. Sửa ghi chú hồ sơ trước rồi cất lại.';

/** Thứ cần tìm trong ghi chú, và ký tự bỏ khỏi ghi chú trước khi tìm. */
interface NoteProbe {
  value: string;
  strip: RegExp | null;
}

/**
 * Ghi chú là cột dạng rõ mà mọi người xem danh sách đều đọc được (Q-18, FR-035).
 * Thông báo lỗi KHÔNG nhắc lại giá trị: thân lỗi đi qua log, toast và công cụ trình duyệt.
 */
function assertNoteHoldsNoValue(
  note: string | null | undefined,
  probe: NoteProbe,
  message: string,
): void {
  const seen = probe.strip && note ? note.replace(probe.strip, '') : note;
  if (noteContainsSecret(seen, probe.value)) {
    throw new BadRequestException({
      code: 'NOTE_CONTAINS_SECRET',
      message: `${message} Ghi chú không được mã hóa — không ghi mật khẩu vào đó.`,
    });
  }
}

/**
 * Ghi chú có một từ trông như mật khẩu (Q-18). Dùng cả khi sửa riêng ghi chú: đường đó không có
 * giá trị trong tay, và giải mã ra để so là một lần mở két không ai xin (NFR-03).
 */
function assertNoteLooksPlain(note: string | null | undefined): void {
  if (noteLooksLikeSecret(note)) {
    throw new BadRequestException({
      code: 'NOTE_LOOKS_LIKE_SECRET',
      message:
        'Ghi chú có một chuỗi trông như mật khẩu. Ghi chú không được mã hóa — cất mật khẩu vào ô Giá trị. ' +
        'Nếu đó là tên máy hay mã model, tách bằng dấu cách.',
    });
  }
}

/** 0 hàng = secret không có hoặc đã bị thu hồi — với người gọi hai chuyện ấy là một: 404. */
function requireAliveRow<T>(rows: readonly T[]): T {
  if (rows.length === 0) {
    throw new NotFoundException({
      code: 'SECRET_NOT_FOUND',
      message: 'Không tìm thấy ngăn két này (có thể đã xóa vĩnh viễn).',
    });
  }
  return rows[0];
}

/**
 * Bỏ MỌI cột mã hóa trước khi bản ghi rời module (AD-4).
 * Liệt kê tường minh trường được phép ra ngoài, không dùng `delete` trên bản sao: thêm cột
 * bí mật mới về sau mà quên xóa thì kiểu dữ liệu vẫn đúng và nó lặng lẽ lọt ra.
 */
function toMeta(row: typeof secretTable.$inferSelect): SecretMeta {
  return {
    id: row.id,
    ownerType: row.ownerType as SecretOwnerType,
    ownerId: row.ownerId,
    kind: row.kind as SecretKind,
    label: row.label,
    username: row.username,
    note: row.note,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    valueChangedAt: row.valueChangedAt,
    valueChangedBy: row.valueChangedBy ?? row.createdBy,
  };
}
