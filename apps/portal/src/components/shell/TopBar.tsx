import * as React from "react";
import { useNavigate } from "react-router-dom";
import { Bell, ChevronDown, Search } from "lucide-react";

import {
  Avatar,
  AvatarFallback,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  RegimeChip,
} from "@/components/ui";
import type { FirmRole, PortalRole } from "@/mock";
import { cn, initials } from "@/lib/utils";
import {
  FIRM_ROLES,
  PORTAL_ROLES,
  useSession,
  type SessionMode,
  type ShellVariant,
} from "@/session";

import { ClientSwitcher } from "./ClientSwitcher";

/**
 * 60px top bar. Firm mode shows the client switcher; portal mode a static client
 * label + "CLIENT PORTAL" pill. Right side: global search, notification bell, and
 * an avatar menu that doubles as the (demo-only) RBAC / view / shell switcher —
 * the real preference surface replacing the prototype's floating toggle bar.
 */
export function TopBar(): React.JSX.Element {
  const navigate = useNavigate();
  const {
    mode,
    user,
    firmRole,
    portalRole,
    activeClient,
    regime,
    shellVariant,
    setMode,
    setFirmRole,
    setPortalRole,
    setShellVariant,
  } = useSession();

  return (
    <header className="relative z-30 flex h-[60px] flex-none items-center gap-4 border-b border-line-strong bg-topbar px-6">
      {/* Left: client context */}
      {mode === "firm" ? (
        <ClientSwitcher />
      ) : (
        <div className="flex items-center gap-2.5">
          <span className="text-[13.5px] font-semibold text-navy">
            {activeClient?.name ?? "Your business"}
          </span>
          {regime ? <RegimeChip regime={regime} /> : null}
          <span className="rounded-chip border border-gold-soft px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-gold-deep">
            CLIENT PORTAL
          </span>
        </div>
      )}

      {/* Global search */}
      <div className="relative ml-auto w-full max-w-[420px]">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-content-muted" />
        <Input
          type="search"
          aria-label="Search"
          placeholder="Search transactions, clients, filings…  ⌘K"
          className="bg-paper py-2 pl-9 text-[13px] focus:bg-card"
        />
      </div>

      {/* Notification bell */}
      <Button
        variant="outline"
        aria-label="Notifications"
        className="relative h-9 w-9 flex-none p-0"
      >
        <Bell className="h-4 w-4 text-content-tertiary" />
        <span className="absolute right-2 top-2 h-[7px] w-[7px] rounded-full border-[1.5px] border-card bg-danger" />
      </Button>

      {/* Avatar menu (+ demo role/view/shell switcher) */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Account menu"
            className="flex items-center gap-2 rounded-btn px-1 py-1 transition-colors hover:bg-rowhover"
          >
            <Avatar className="h-8 w-8">
              <AvatarFallback className="text-[12px]">
                {initials(user.name)}
              </AvatarFallback>
            </Avatar>
            <ChevronDown className="h-3 w-3 text-content-secondary" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[248px]">
          <div className="border-b border-line px-3 pb-2.5 pt-1.5">
            <div className="text-[13.5px] font-semibold text-content">
              {user.name}
            </div>
            <div className="text-[12px] text-content-muted">{user.email}</div>
          </div>

          <div className="py-1">
            <DropdownMenuItem>Profile &amp; security</DropdownMenuItem>
            <DropdownMenuItem>Preferences</DropdownMenuItem>
          </div>

          <DropdownMenuSeparator />

          {/* Demo: switch the active role to preview RBAC */}
          <DropdownMenuLabel>Demo role</DropdownMenuLabel>
          {mode === "firm" ? (
            <DropdownMenuRadioGroup
              value={firmRole}
              onValueChange={(v) => setFirmRole(v as FirmRole)}
            >
              {FIRM_ROLES.map((role) => (
                <DropdownMenuRadioItem key={role} value={role}>
                  {role}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          ) : (
            <DropdownMenuRadioGroup
              value={portalRole}
              onValueChange={(v) => setPortalRole(v as PortalRole)}
            >
              {PORTAL_ROLES.map((role) => (
                <DropdownMenuRadioItem key={role} value={role}>
                  {role}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          )}

          <DropdownMenuSeparator />

          {/* Demo: switch audience + shell variant */}
          <div className="grid grid-cols-2 gap-1 px-1 py-1">
            <PreferenceToggle
              label="View"
              value={mode}
              options={[
                { value: "firm", label: "Firm" },
                { value: "portal", label: "Portal" },
              ]}
              onChange={(v) => setMode(v as SessionMode)}
            />
            <PreferenceToggle
              label="Shell"
              value={shellVariant}
              options={[
                { value: "A", label: "A" },
                { value: "B", label: "B" },
              ]}
              onChange={(v) => setShellVariant(v as ShellVariant)}
            />
          </div>

          <DropdownMenuSeparator />

          <DropdownMenuItem
            className="text-danger focus:bg-danger-bg"
            onSelect={() => navigate("/login")}
          >
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}

interface PreferenceToggleProps {
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
}

/** A tiny segmented preference control used inside the avatar menu. */
function PreferenceToggle({
  label,
  value,
  options,
  onChange,
}: PreferenceToggleProps): React.JSX.Element {
  return (
    <div className="px-1.5">
      <div className="eyebrow mb-1">{label}</div>
      <div className="flex overflow-hidden rounded-btn border border-line-input">
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={cn(
              "flex-1 px-2 py-1 text-[12px] font-semibold transition-colors",
              value === opt.value
                ? "bg-navy text-white"
                : "bg-card text-content-secondary hover:bg-rowhover",
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
