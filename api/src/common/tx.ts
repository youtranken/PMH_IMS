import type { Database } from '../database/database.module';

/**
 * AD-5: một request ghi = một transaction, `tx` TRUYỀN TƯỜNG MINH xuống mọi hàm ghi.
 * Không AsyncLocalStorage, không connection ngầm — nhìn chữ ký hàm là biết nó ghi trong tx nào.
 *
 * Dùng:
 *   await this.db.transaction(async (tx) => {
 *     await this.devices.insert(tx, dto);
 *     await this.audit.appendWithin(tx, {...});   // audit chung transaction
 *     await this.outbox.enqueueWithin(tx, 'device.created', { id });  // mail chung transaction
 *   });
 */
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/** Hàm ghi nghiệp vụ luôn nhận `tx` làm THAM SỐ ĐẦU (đọc chữ ký là thấy ngay). */
export type WriteFn<TArgs extends unknown[], TResult> = (
  tx: Tx,
  ...args: TArgs
) => Promise<TResult>;
