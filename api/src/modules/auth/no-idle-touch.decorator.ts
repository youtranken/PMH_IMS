import { SetMetadata } from '@nestjs/common';

export const NO_IDLE_TOUCH_KEY = 'noIdleTouch';
export const NoIdleTouch = () => SetMetadata(NO_IDLE_TOUCH_KEY, true);
