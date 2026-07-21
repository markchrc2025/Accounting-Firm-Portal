import { Module } from "@nestjs/common";
import { MailService } from "./mail.service";

/** Outbound email (provider-agnostic; see MailService). */
@Module({
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
