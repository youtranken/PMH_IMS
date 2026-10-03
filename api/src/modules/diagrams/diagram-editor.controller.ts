import { Controller, Get } from '@nestjs/common';
import { Roles } from '../auth/roles.decorator';
import { NoStepUp } from '../auth/step-up.decorator';
import { SystemConfigService } from '../config-sys/system-config.service';

export interface DiagramEditorSettings {
  /** `diagram.editor_init_timeout_seconds` */
  initTimeoutSeconds: number;
}

/**
 * Tham số mà màn sơ đồ cần trước khi mở trình vẽ. Không chứa nội dung bản vẽ nên `@NoStepUp()`;
 * mọi vai vì Thành viên cũng vẽ (bản của họ đi qua duyệt, Q-23).
 */
@NoStepUp()
@Controller('api/v1/diagrams')
export class DiagramEditorController {
  constructor(private readonly config: SystemConfigService) {}

  @Roles('sa', 'admin', 'member')
  @Get('editor-settings')
  async editorSettings(): Promise<DiagramEditorSettings> {
    return { initTimeoutSeconds: await this.config.getNumber('diagramEditorInitTimeoutSeconds') };
  }
}
