import { Module } from "@nestjs/common";
import { FinancialModule } from "../financial/financial.module";
import { PurchaseTransactionsModule } from "../purchase-transactions/purchase-transactions.module";
import { AiSettingsService } from "./ai-settings.service";
import { AI_BATCH_CLIENT, AI_CLOCK, AI_POLLER_TIMER } from "./ai.tokens";
import { AiController } from "./ai.controller";
import { AnthropicBatchClient } from "./batch-client";
import {
  ReceiptScanController,
  ReceiptScanFileController,
} from "./receipt-scan.controller";
import { ReceiptScanPreparer } from "./receipt-scan.preparer";
import { DriveModule } from "../drive/drive.module";
import { ReceiptScanPoller, realPollerTimer } from "./receipt-scan.poller";
import { ReceiptScanService } from "./receipt-scan.service";

/**
 * U11 (D49): AI reads receipts overnight. The Anthropic key is read from the
 * environment once, here, and handed only to the SDK.
 */
@Module({
  imports: [FinancialModule, PurchaseTransactionsModule, DriveModule],
  controllers: [AiController, ReceiptScanController, ReceiptScanFileController],
  providers: [
    AiSettingsService,
    ReceiptScanService,
    ReceiptScanPoller,
    ReceiptScanPreparer,
    {
      provide: AI_BATCH_CLIENT,
      useFactory: () => new AnthropicBatchClient(process.env.ANTHROPIC_API_KEY),
    },
    { provide: AI_CLOCK, useValue: { now: () => new Date() } },
    { provide: AI_POLLER_TIMER, useValue: realPollerTimer },
  ],
})
export class AiModule {}
