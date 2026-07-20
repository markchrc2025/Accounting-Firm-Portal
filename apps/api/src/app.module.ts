import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { AuditModule } from "./audit/audit.module";
import { AuthModule } from "./auth/auth.module";
import { BirModule } from "./bir/bir.module";
import { CategoriesModule } from "./categories/categories.module";
import { ClientsModule } from "./clients/clients.module";
import { CoaModule } from "./coa/coa.module";
import { DashboardModule } from "./dashboard/dashboard.module";
import { JwtAuthGuard } from "./common/guards/jwt-auth.guard";
import { PermissionsGuard } from "./common/guards/permissions.guard";
import { ScopesGuard } from "./common/guards/scopes.guard";
import { FilesModule } from "./files/files.module";
import { FilingsModule } from "./filings/filings.module";
import { FinancialModule } from "./financial/financial.module";
import { FsModule } from "./fs/fs.module";
import { HealthModule } from "./health/health.module";
import { IncomeTransactionsModule } from "./income-transactions/income-transactions.module";
import { IntegrationModule } from "./integration/integration.module";
import { InvitationsModule } from "./invitations/invitations.module";
import { InvoicesModule } from "./invoices/invoices.module";
import { McpModule } from "./mcp/mcp.module";
import { PortalModule } from "./portal/portal.module";
import { PrismaModule } from "./prisma/prisma.module";
import { ProfileModule } from "./profile/profile.module";
import { PurchaseTransactionsModule } from "./purchase-transactions/purchase-transactions.module";
import { RbacModule } from "./rbac/rbac.module";
import { RedisModule } from "./redis/redis.module";
import { ServicesModule } from "./services/services.module";
import { StorageModule } from "./storage/storage.module";
import { TaxRulesModule } from "./tax-rules/tax-rules.module";
import { UsersModule } from "./users/users.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    RedisModule,
    StorageModule,
    AuditModule,
    RbacModule,
    AuthModule,
    ClientsModule,
    DashboardModule,
    UsersModule,
    ProfileModule,
    ServicesModule,
    InvitationsModule,
    InvoicesModule,
    PortalModule,
    FinancialModule,
    CategoriesModule,
    IncomeTransactionsModule,
    PurchaseTransactionsModule,
    IntegrationModule,
    FilingsModule,
    TaxRulesModule,
    BirModule,
    CoaModule,
    FsModule,
    FilesModule,
    McpModule,
    HealthModule,
  ],
  providers: [
    // Global auth first, then authorization. Routes opt out of auth with
    // @Public(); PermissionsGuard enforces @RequirePermissions for USER callers,
    // ScopesGuard enforces @RequireScopes for INTEGRATION (machine) callers.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_GUARD, useClass: ScopesGuard },
  ],
})
export class AppModule {}
