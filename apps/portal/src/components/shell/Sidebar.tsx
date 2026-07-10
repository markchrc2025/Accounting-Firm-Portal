import * as React from "react";
import { NavLink } from "react-router-dom";

import { Avatar, AvatarFallback } from "@/components/ui";
import { cn, initials } from "@/lib/utils";
import { isNavVisible, useSession } from "@/session";

import { McrcMark } from "./McrcMark";
import { FIRM_NAV, PORTAL_NAV, type NavGroupDef } from "./nav";

/**
 * Fixed 236px sidebar. Variant A is the cream/navy default; variant B is the navy
 * gradient. Nav is grouped under mono section labels; the active item gets a 3px
 * gold left border, a tinted background, and weight 700. RBAC hides items the
 * current role can't use (Firm Admin group is Super-Admin-only; portal Users &
 * Seats is Owner-only).
 */
export function Sidebar(): React.JSX.Element {
  const { mode, firmRole, portalRole, activeClientId, user, shellVariant } =
    useSession();
  const isNavy = shellVariant === "B";

  const groups: readonly NavGroupDef[] = mode === "firm" ? FIRM_NAV : PORTAL_NAV;

  const visibleGroups = groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) =>
        isNavVisible(item.id, { firmRole, portalRole }),
      ),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <aside
      className={cn(
        "flex w-[236px] flex-none flex-col overflow-auto",
        isNavy
          ? "bg-navy-sidebar"
          : "border-r border-line-strong bg-sidebar",
      )}
    >
      {/* Logo block */}
      <div
        className={cn(
          "flex items-center gap-2.5 border-b px-[18px] pb-4 pt-[18px]",
          isNavy ? "border-white/10" : "border-line",
        )}
      >
        <McrcMark variant={isNavy ? "navy" : "light"} size={30} />
        <div>
          <div
            className={cn(
              "font-serif text-[18px] font-semibold leading-none",
              isNavy ? "text-white" : "text-navy",
            )}
          >
            MCRC
          </div>
          <div
            className={cn(
              "mt-0.5 font-mono text-[8.5px] uppercase tracking-eyebrow",
              isNavy ? "text-gold-bright" : "text-gold-deep",
            )}
          >
            TAX &amp; ACCOUNTING
          </div>
        </div>
      </div>

      {/* Nav groups */}
      <nav className="flex flex-1 flex-col gap-5 p-[14px_12px]">
        {visibleGroups.map((group) => (
          <div key={group.label}>
            <div
              className={cn(
                "px-2.5 pb-2 font-mono text-[10px] uppercase tracking-eyebrow",
                isNavy ? "text-gold-bright" : "text-gold-deep",
              )}
            >
              {group.label}
            </div>
            <div className="flex flex-col gap-0.5">
              {group.items.map((item) => (
                <NavLink
                  key={item.id}
                  to={item.to(activeClientId)}
                  end={item.end}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center rounded-[6px] border-l-[3px] border-transparent px-2.5 py-2 text-left text-[13.5px] transition-colors",
                      isNavy
                        ? "text-blue-muted hover:bg-white/[0.08]"
                        : "text-navy/80 hover:bg-navy/[0.06]",
                      isActive &&
                        (isNavy
                          ? "border-gold bg-white/[0.08] font-bold text-white"
                          : "border-gold bg-navy/[0.06] font-bold text-navy"),
                    )
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* Signed-in user card */}
      <div
        className={cn(
          "flex items-center gap-2.5 border-t p-[14px_16px]",
          isNavy ? "border-white/10" : "border-line",
        )}
      >
        <Avatar className="h-8 w-8">
          <AvatarFallback
            className={cn(
              "text-[12px]",
              isNavy ? "bg-gold-soft text-navy" : "bg-navy text-gold-soft",
            )}
          >
            {initials(user.name)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <div
            className={cn(
              "truncate text-[13px] font-semibold",
              isNavy ? "text-paper" : "text-content",
            )}
          >
            {user.name}
          </div>
          <div
            className={cn(
              "text-[11.5px]",
              isNavy ? "text-blue-muted" : "text-content-muted",
            )}
          >
            {user.role}
          </div>
        </div>
      </div>
    </aside>
  );
}
