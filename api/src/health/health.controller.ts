import { Controller, Get } from '@nestjs/common';
import { Public } from '../modules/auth/public.decorator';
import { NoStepUp } from '../modules/auth/step-up.decorator';

@NoStepUp()
@Controller('health')
export class HealthController {
  @Public()
  @Get()
  check(): { status: string } {
    return { status: 'ok' };
  }
}
