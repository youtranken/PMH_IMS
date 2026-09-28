import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, asc, count, eq, isNull, max } from 'drizzle-orm';
import { DRIZZLE_DB } from '../../database/database.module';
import type { Database } from '../../database/database.module';
import { EnvelopeCryptoService } from '../../common/crypto/envelope.service';
import type { SealedValue } from '../../common/crypto/envelope.types';
import { conflictOnUnique } from '../../common/sql';
import { AuditWriterService } from '../audit/audit-writer.service';
import { OwnerExistsRegistry } from '../../common/owner-exists.registry';
import { secretTable } from './vault.schema';

/*
 * Thêm `isp` (0036): `file.owner_type` đã nhận đường truyền từ lâu, nên hợp đồng PDF đính vào
 * được mà mật khẩu PPPoE thì không có chỗ đứng — bất đối xứng đẩy mật khẩu thật vào ô Ghi chú
 * không mã hóa. Whitelist này có BẢN SAO ở tầng DB (`secret_owner_type_check`) và ở
 * `SecretOwnerType` bên web; thêm loại mới phải sờ đủ ba chỗ.
 */
export const SECRET_OWNER_TYPES = ['device', 'software', 'service_account', 'isp'] as const;
export type SecretOwnerType = (typeof SECRET_OWNER_TYPES)[number];

export const SECRET_KINDS = ['password', 'license_key', 'other'] as const;
export type SecretKind = (typeof SECRET_KINDS)[number];

/**
 * Thông tin secret KHÔNG kèm giá trị bí mật.
 *
 * Đây là thứ DUY NHẤT rời khỏi module vault ở story 4.1: tên, loại, ai cất, lúc nào.
 * Việc mở két (xem plaintext) là story 4.2 và có đường riêng, cần TOTP step-up.
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
 * Két sắt (story 4.1, FR-021, AD-4).
 *
 * Luật sống còn của module này:
 *  - Plaintext CHỈ tồn tại trong tham số hàm và trong bộ nhớ đúng lúc mã/giải. Không log,
 *    không audit detail, không trả về ở bất kỳ hàm nào ngoài đường "mở két" của story 4.2.
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
    const value = input.value;
    if (!value) {
      throw new BadRequestException({
        code: 'SECRET_EMPTY',
        message: 'Chưa nhập giá trị cần cất.',
      });
    }
    const label = input.label.trim();
    if (!label) {
      throw new BadRequestException({
        code: 'FIELD_REQUIRED',
        message: 'Đặt nhãn cho secret này (vd "admin web", "SSH root").',
      });
    }

    /*
     * Chủ thể phải CÓ THẬT trước khi cất bí mật vào (cùng hàng rào với kho file).
     *
     * Bí mật cất vào một `ownerId` bịa ra là bí mật KHÔNG AI MỞ LẠI ĐƯỢC — kể cả chính người
     * vừa cất: mọi đường đọc đều đi qua `listFor(ownerType, ownerId)` từ một trang hồ sơ có
     * thật. Nó nằm đó, chiếm chỗ, tính vào số đếm, và mã hóa bằng một DEK không bao giờ được
     * mở nữa.
     */
    await this.owners.assertExists(input.ownerType, input.ownerId);

    const id = randomUUID();
    const sealed = this.crypto.seal(value, { table: AAD_TABLE, recordId: id });

    try {
      return await this.db.transaction(async (tx) => {
        /*
         * HỒ SƠ ĐÃ NGỪNG DÙNG THÌ KÉT ĐÓNG BĂNG (thêm 17/09/2026).
         *
         * Trang chi tiết thiết bị đã dạy người dùng luật này từ lâu (`canEdit={… && !retired}`)
         * nhưng nó chỉ sống ở MỘT màn: `/vault` không xét trạng thái hồ sơ và API không chặn,
         * nên đi đường đó là cất được mật khẩu mới vào một cái máy đã thanh lý. Giờ luật ở
         * tầng ghi, tức đúng ở mọi cửa.
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
  async rotate(actor: string, id: string, value: string): Promise<void> {
    if (!value) {
      throw new BadRequestException({
        code: 'SECRET_EMPTY',
        message: 'Chưa nhập giá trị mới.',
      });
    }
    const current = await this.requireAlive(id);
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
    if (input.note !== undefined) values.note = input.note?.trim() || null;

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
   * Mở két — trả về PLAINTEXT. Story 4.2 gắn TOTP step-up trước khi gọi được hàm này;
   * ở 4.1 chưa có endpoint nào dẫn tới đây.
   *
   * Mỗi lần gọi ghi MỘT dòng audit (NFR-03). Ghi TRƯỚC khi trả giá trị: giải mã được mà
   * mất vết thì đúng thứ két sắt sinh ra để chống.
   */
  async reveal(
    actor: string,
    id: string,
    /** Grant break-glass đã dùng (story 6.3). `null` = quyền đến từ vai hoặc whitelist. */
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
      message: `Chủ thể này đã có secret nhãn "${label}". Đổi nhãn hoặc thu hồi cái cũ trước.`,
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

/** 0 hàng = secret không có hoặc đã bị thu hồi — với người gọi hai chuyện ấy là một: 404. */
function requireAliveRow<T>(rows: readonly T[]): T {
  if (rows.length === 0) {
    throw new NotFoundException({
      code: 'SECRET_NOT_FOUND',
      message: 'Không tìm thấy secret này (có thể đã thu hồi).',
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
