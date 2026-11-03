import { Module } from "@nestjs/common";
import { ConfirmationService } from "./confirmation.service";

/** U18 (D58): the BIR filing confirmation. Prisma, storage, audit and RBAC are global. */
@Module({
  providers: [ConfirmationService],
  exports: [ConfirmationService],
})
export class ConfirmationModule {}
