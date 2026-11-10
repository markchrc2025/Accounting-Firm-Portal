// SecurityChip - a project's security state in a few words (PB4): Clear, "3 open", or "Blocked: 1
// critical, 2 high". The words carry the meaning; the colour only helps.

import { Chip } from "../ui";
import { securityText, type SecurityBadge } from "../../lib/projects";

export function SecurityChip({ badge }: { badge: SecurityBadge }) {
  return (
    <Chip
      data-security-state={badge.state}
      variant={
        badge.state === "blocked" ? "danger" : badge.state === "open" ? "warn" : "success"
      }
    >
      {securityText(badge)}
    </Chip>
  );
}
