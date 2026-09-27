import { Logger } from '@nestjs/common';
import { redactMessage } from '../common/log-redact';
import { migrateDatabase } from '../database/migrate';

/** Service `migrate` của compose: dựng role + áp migration, rồi thoát (0 = api được phép lên). */
migrateDatabase(new Logger('Migrations')).catch((error: unknown) => {
  new Logger('Migrations').error(`Migration thất bại: ${redactMessage(error)}`);
  process.exit(1);
});
