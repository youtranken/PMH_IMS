import { Injectable } from '@nestjs/common';
import type { Tx } from '../../common/tx';
import { FilesService, type FileOwnerType, type FileRecord } from './files.service';
export type { FileRecord } from './files.service';

/**
 * AD-2: public api DUY NHẤT của module `files`.
 * Module nghiệp vụ (devices, sheets, incidents) hỏi "chủ thể này có
 * mấy file đính kèm" qua đây, KHÔNG query bảng `file`.
 */
@Injectable()
export class FilesApiService {
  constructor(private readonly files: FilesService) {}

  listFor(ownerType: FileOwnerType, ownerId: string): Promise<FileRecord[]> {
    return this.files.listFor(ownerType, ownerId);
  }

  /** Ảnh còn sống theo id — vắng mặt = không có, đã xoá, hoặc không phải ảnh. */
  imagesByIds(ids: string[]): Promise<Map<string, FileRecord>> {
    return this.files.imagesByIds(ids);
  }

  /** Nội dung ảnh còn sống (server tự thu nhỏ/nhúng, không trả nguyên bản cho trình duyệt). */
  readImage(id: string): Promise<{ mime: string; bytes: Buffer } | null> {
    return this.files.readImage(id);
  }

  /**
   * Xoá mềm các tệp ẢNH vừa bị thay / bỏ (Q-26 07/10) trong transaction của nơi gọi — ảnh cũ không
   * đọng lại trong Giấy tờ. Còn khôi phục được tới khi `purgeDeleted` gỡ blob.
   */
  trashWithin(tx: Tx, actor: string, ids: string[]): Promise<void> {
    return this.files.trashWithin(tx, actor, ids);
  }

  /** Đếm nhanh để trang chi tiết hiện số trên nhãn tab mà không cần tải cả danh sách. */
  async countFor(ownerType: FileOwnerType, ownerId: string): Promise<number> {
    return (await this.files.listFor(ownerType, ownerId)).length;
  }
}
