import { BadRequestException } from "@nestjs/common";
import { BirFormSource } from "@portal/shared";

/**
 * U15 (D54): a draft's data may carry the optional `_source` key — where its figures
 * came from (BirFormSource in @portal/shared). The key is saved and returned like
 * any other data key and nothing here changes it; a malformed one is refused, in a
 * sentence, before anything is saved.
 */
export function assertValidDraftSource(data: Record<string, unknown> | undefined): void {
  if (!data || data["_source"] === undefined) return;
  const result = BirFormSource.safeParse(data["_source"]);
  if (result.success) return;
  const issue = result.error.issues[0]!;
  const where = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
  throw new BadRequestException(
    `The draft's _source isn't valid. ${where}${issue.message}`,
  );
}
