import { IsOptional, IsString } from 'class-validator';
import { OptionalUuidListQuery, OptionalUuidQuery } from '../../common/query-uuid';

/** Bộ lọc dùng chung của danh sách và file xuất — file xuất phải khớp cái đang xem (FR-028). */
export class DeviceExportQueryDto {
  @IsOptional() @IsString() search?: string;
  @OptionalUuidQuery('Mã site không hợp lệ.') siteId?: string;
  @OptionalUuidQuery('Mã tủ rack không hợp lệ.') cabinetId?: string;
  @OptionalUuidQuery('Mã loại thiết bị không hợp lệ.') deviceTypeId?: string;
  /** `live` = trừ máy đã thanh lý (Q-20). Xem `deviceStatusQuery`. */
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() sort?: string;
  @IsOptional() @IsString() dir?: string;
}

export class DeviceListQueryDto extends DeviceExportQueryDto {
  @IsOptional() @IsString() page?: string;
  @IsOptional() @IsString() limit?: string;
  /** Nhiều loại, ngăn bởi dấu phẩy — ô chọn thiết bị lọc theo loại (Q-20). */
  @OptionalUuidListQuery('Danh sách loại thiết bị không hợp lệ.') deviceTypeIds?: string;
  /** '?usable=true' — chỉ máy còn nhận thêm được. Xem `DeviceFilter.usableOnly`. */
  @IsOptional() @IsString() usable?: string;
  /** Khớp đúng phòng ban / người sử dụng — hộp gán license chọn cả lô (SW-053). */
  @IsOptional() @IsString() department?: string;
  @IsOptional() @IsString() assignedTo?: string;
}
