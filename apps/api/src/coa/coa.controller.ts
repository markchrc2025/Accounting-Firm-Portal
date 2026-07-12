import { Controller, Get, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { CoaService } from "./coa.service";

/**
 * Chart of Accounts reference data (global, seeded from the xlsx source of
 * truth). Any authenticated user may read it — it backs the Firm Admin
 * "Chart of Accounts" screen and, later, Account pickers.
 */
@ApiTags("coa")
@Controller("coa")
export class CoaController {
  constructor(private readonly coa: CoaService) {}

  @Get("accounts")
  accounts(@Query("class") cls?: string, @Query("search") search?: string) {
    return this.coa.listAccounts({ class: cls, search });
  }

  @Get("mappings")
  mappings() {
    return this.coa.listMappings();
  }
}
