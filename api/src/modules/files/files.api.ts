import { Injectable } from '@nestjs/common';
import { FilesService, type FileOwnerType, type FileRecord } from './files.service';

/**
 * AD-2: public api DUY NHẤT của module `files`.
 * Module nghiệp vụ (devices 2.3, sheets Epic 8, incidents Epic 9) hỏi "chủ thể này có
 * mấy file đính kèm" qua đây, KHÔNG query bảng `file`.
 */
@Injectable()
export class FilesApiService {
  constructor(private readonly files: FilesService) {}

  listFor(ownerType: FileOwnerType, ownerId: string): Promise<FileRecord[]> {
    return this.files.listFor(ownerType, ownerId);
  }

  /** Đếm nhanh để trang chi tiết hiện số trên nhãn tab mà không cần tải cả danh sách. */
  async countFor(ownerType: FileOwnerType, ownerId: string): Promise<number> {
    return (await this.files.listFor(ownerType, ownerId)).length;
  }
}
