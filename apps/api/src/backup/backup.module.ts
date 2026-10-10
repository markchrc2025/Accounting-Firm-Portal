/**
 * backup.module.ts — wires the backups into the running API (D38).
 *
 * BackupService is built from the files module's StorageService (the same
 * bucket, the same credentials — R2) and the app's ConfigService. The nightly
 * is armed once the application has booted and disarmed when it shuts down.
 * The pre-migrate step does not live here: it runs before the app exists, as
 * its own process (pre-migrate.ts), from docker-start.sh.
 */
import {
  Injectable,
  Module,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import { NightlyScheduler } from "./backup.scheduler";
import { BackupService } from "./backup.service";
import { readServerVersionNum } from "./server-version";

@Injectable()
export class NightlyBackupHost implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly scheduler: NightlyScheduler;

  constructor(service: BackupService) {
    this.scheduler = new NightlyScheduler({
      gate: service.gate(),
      run: (now) => service.runNightly(now),
    });
  }

  onApplicationBootstrap(): void {
    this.scheduler.start();
  }

  onModuleDestroy(): void {
    this.scheduler.stop();
  }
}

@Module({
  providers: [
    {
      provide: BackupService,
      useFactory: (
        storage: StorageService,
        config: ConfigService,
        prisma: PrismaService,
      ) =>
        new BackupService({
          store: storage,
          env: (name) => config.get<string>(name),
          serverVersionNum: () => readServerVersionNum(prisma),
        }),
      inject: [StorageService, ConfigService, PrismaService],
    },
    NightlyBackupHost,
  ],
  exports: [BackupService],
})
export class BackupModule {}
