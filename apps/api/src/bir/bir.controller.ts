import { Controller, Get, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { BirService } from "./bir.service";

/**
 * BIR tax-code reference data (national codes, firm-agnostic). Any authenticated
 * user may read it — it drives the tax-type / ATC pickers and import validation.
 */
@ApiTags("bir")
@Controller("bir")
export class BirController {
  constructor(private readonly bir: BirService) {}

  @Get("tax-types")
  taxTypes(@Query("status") status?: string) {
    return this.bir.listTaxTypes(status);
  }

  @Get("atc-codes")
  atcCodes(
    @Query("classification") classification?: string,
    @Query("taxTypeCode") taxTypeCode?: string,
    @Query("status") status?: string,
    @Query("search") search?: string,
  ) {
    return this.bir.listAtcCodes({ classification, taxTypeCode, status, search });
  }
}
