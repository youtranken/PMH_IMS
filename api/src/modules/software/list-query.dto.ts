import { IsIn, IsOptional, IsString } from 'class-validator';
import { OptionalUuidQuery } from '../../common/query-uuid';
import { SOFTWARE_KINDS, type LicenseModel, type SoftwareKind, type SoftwareStatus } from './software-rules';

/** Bộ lọc phần mềm — dùng chung cho danh sách và file xuất (FR-028). */
export class SoftwareExportQueryDto {
  @IsOptional() @IsString() search?: string;
  // `kind` đi thẳng xuống `eq` trên cột enum: giá trị lạ cũng là 22P02 → 500.
  @IsOptional()
  @IsIn([...SOFTWARE_KINDS, ''], { message: 'Loại phần mềm không hợp lệ.' })
  kind?: SoftwareKind;
  /** Giá trị lạ bị `filterOf` bỏ qua, nên không cần chặn ở đây. */
  @IsOptional() @IsString() licenseModel?: LicenseModel;
  @IsOptional() @IsString() status?: SoftwareStatus | 'live';
  @OptionalUuidQuery('Mã nhà cung cấp không hợp lệ.') vendorId?: string;
  @IsOptional() @IsString() sort?: string;
  @IsOptional() @IsString() dir?: string;
}

export class SoftwareListQueryDto extends SoftwareExportQueryDto {
  @IsOptional() @IsString() page?: string;
  @IsOptional() @IsString() limit?: string;
}

/** Bộ lọc đường truyền — dùng chung cho danh sách và file xuất (FR-028). */
export class IspExportQueryDto {
  @IsOptional() @IsString() search?: string;
  @OptionalUuidQuery('Mã site không hợp lệ.') siteId?: string;
  @OptionalUuidQuery('Mã nhà cung cấp không hợp lệ.') providerId?: string;
  /** `active,suspended` — service tự kiểm từng phần (`ISP_STATUS_INVALID`). */
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() sort?: string;
  @IsOptional() @IsString() dir?: string;
}

export class IspListQueryDto extends IspExportQueryDto {
  @IsOptional() @IsString() page?: string;
  @IsOptional() @IsString() limit?: string;
}
