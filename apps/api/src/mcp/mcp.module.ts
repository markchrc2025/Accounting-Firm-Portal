import { Module } from "@nestjs/common";
import { McpController } from "./mcp.controller";
import { McpService } from "./mcp.service";

/** MCP (Model Context Protocol) endpoint — read-only Portal data for Claude. */
@Module({
  controllers: [McpController],
  providers: [McpService],
})
export class McpModule {}
