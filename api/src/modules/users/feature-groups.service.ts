import { Inject, Injectable } from '@nestjs/common';
import { asc, count, eq } from 'drizzle-orm';
import { DRIZZLE_DB } from '../../database/database.module';
import type { Database } from '../../database/database.module';
import type { Tx } from '../../common/tx';
import { featureGroupTable } from './feature-groups.schema';
import { usersTable } from './users.schema';
import type { FeatureGroup } from './users.types';

/** Chủ sở hữu bảng `feature_group` (AD-3, Q-31). Hàm ghi nhận `tx` tường minh (AD-5). */
@Injectable()
export class FeatureGroupsService {
  constructor(@Inject(DRIZZLE_DB) private readonly db: Database) {}

  async list(): Promise<FeatureGroup[]> {
    const rows = await this.db
      .select({
        id: featureGroupTable.id,
        name: featureGroupTable.name,
        features: featureGroupTable.features,
        memberCount: count(usersTable.id),
      })
      .from(featureGroupTable)
      .leftJoin(usersTable, eq(usersTable.featureGroupId, featureGroupTable.id))
      .groupBy(featureGroupTable.id)
      .orderBy(asc(featureGroupTable.name));
    return rows.map((row) => ({ ...row, memberCount: Number(row.memberCount) }));
  }

  /** Khóa dòng nhóm tới hết transaction: đổi tick và gán người vào nhóm không chen nhau. */
  async lockWithin(tx: Tx, id: string): Promise<{ id: string; name: string; features: string[] } | null> {
    const [row] = await tx
      .select({ id: featureGroupTable.id, name: featureGroupTable.name, features: featureGroupTable.features })
      .from(featureGroupTable)
      .where(eq(featureGroupTable.id, id))
      .for('update');
    return row ?? null;
  }

  async memberIdsWithin(tx: Tx, id: string): Promise<string[]> {
    const rows = await tx
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.featureGroupId, id));
    return rows.map((row) => row.id);
  }

  async createWithin(tx: Tx, input: { name: string; features: string[] }): Promise<string> {
    const [row] = await tx
      .insert(featureGroupTable)
      .values({ name: input.name, features: input.features })
      .returning({ id: featureGroupTable.id });
    return row.id;
  }

  async updateWithin(tx: Tx, id: string, patch: { name?: string; features?: string[] }): Promise<void> {
    await tx
      .update(featureGroupTable)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(featureGroupTable.id, id));
  }

  async deleteWithin(tx: Tx, id: string): Promise<void> {
    await tx.delete(featureGroupTable).where(eq(featureGroupTable.id, id));
  }
}
