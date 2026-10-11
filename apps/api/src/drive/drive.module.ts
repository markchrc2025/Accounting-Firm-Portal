import { Module } from "@nestjs/common";
import { DRIVE_API, DRIVE_FETCH, GoogleDriveApi, type FetchLike } from "./drive-api";
import { DriveController } from "./drive.controller";
import { DriveService } from "./drive.service";

/**
 * U14 (D51): Google Drive, read-only, through the robot account whose key is in
 * GOOGLE_SERVICE_ACCOUNT_JSON (API service only). The HTTP client (DRIVE_FETCH) and
 * the Drive client itself (DRIVE_API) are injectable, so tests reach no Google.
 */
@Module({
  controllers: [DriveController],
  providers: [
    DriveService,
    { provide: DRIVE_FETCH, useValue: ((url, init) => fetch(url, init)) as FetchLike },
    {
      provide: DRIVE_API,
      useFactory: (fetcher: FetchLike) => new GoogleDriveApi(fetcher),
      inject: [DRIVE_FETCH],
    },
  ],
  exports: [DriveService, DRIVE_API],
})
export class DriveModule {}
