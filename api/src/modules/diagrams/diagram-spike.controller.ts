import { Body, Controller, Get, Param, Put, Req } from '@nestjs/common';
import { IsString, Matches, MaxLength } from 'class-validator';
import { Audited } from '../audit/audited.decorator';
import { Roles } from '../auth/roles.decorator';
import { NoStepUp } from '../auth/step-up.decorator';
import type { AuthedRequest } from '../auth/types';
import { DiagramSpikeService } from './diagram-spike.service';

/** Trần XML — khớp CHECK của bảng và trần body riêng của route này ở `app.setup.ts`. */
export const DIAGRAM_SPIKE_MAX_BYTES = 5 * 1024 * 1024;

class NameParamDto {
  @Matches(/^[A-Za-z0-9_-]{1,60}$/, { message: 'Tên bản vẽ chỉ gồm chữ không dấu, số, "-" và "_".' })
  name!: string;
}

class SaveDiagramDto {
  @IsString()
  @MaxLength(DIAGRAM_SPIKE_MAX_BYTES, { message: 'Bản vẽ vượt 5 MB.' })
  xml!: string;
}

/**
 * BẢN THỬ nhúng draw.io (Q-23) — chỉ SA/Admin, để chủ dự án vẽ thử trước khi chốt Epic 10.
 *
 * `@NoStepUp()` là cố ý cho bản thử: phạm vi step-up `diagram` (Story 10.1) chưa có. Bản thật
 * khai `@RequiresStepUp('diagram')` cho mọi route đọc nội dung bản vẽ.
 */
@NoStepUp()
@Controller('api/v1/diagram-spike')
export class DiagramSpikeController {
  constructor(private readonly diagrams: DiagramSpikeService) {}

  @Roles('sa', 'admin')
  @Get(':name')
  get(@Param() params: NameParamDto) {
    return this.diagrams.get(params.name);
  }

  @Roles('sa', 'admin')
  @Put(':name')
  @Audited('diagram_spike.saved', 'diagram_spike', { writtenByService: true })
  save(@Param() params: NameParamDto, @Body() dto: SaveDiagramDto, @Req() req: AuthedRequest) {
    return this.diagrams.save(req.user!.email, params.name, dto.xml);
  }
}
