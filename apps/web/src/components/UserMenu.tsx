import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { fetchProfile } from "../lib/api";
import { cn } from "./ui";

/**
 * Top-bar user menu — the single avatar affordance (replaces the old lower-left
 * sidebar card). Shows the user's uploaded photo (or initials), and a dropdown
 * with the account header, a link to the profile page, and sign out.
 */
function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

export function UserMenu() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Own profile — for the avatar photo. Cheap + cached; refetched after upload.
  const { data: profile } = useQuery({ queryKey: ["profile"], queryFn: fetchProfile });
  const name = user?.fullName ?? "";
  const avatarUrl = profile?.avatarUrl ?? null;

  function handleSignOut() {
    signOut();
    navigate("/login", { replace: true });
  }

  const AvatarCircle = (
    <span className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-navy font-mono text-[11px] font-semibold text-gold-soft">
      {avatarUrl ? (
        <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
      ) : (
        initials(name)
      )}
    </span>
  );

  return (
    <div
      ref={wrapRef}
      className="relative"
      onBlur={(e) => {
        if (!wrapRef.current?.contains(e.relatedTarget as Node)) setOpen(false);
      }}
    >
      <button
        type="button"
        aria-label="Account menu"
        onClick={() => setOpen((v) => !v)}
        className="rounded-full ring-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue"
      >
        {AvatarCircle}
      </button>

      {open && (
        <div className="absolute right-0 top-[calc(100%+8px)] z-40 w-[248px] rounded-card border border-line-strong bg-card shadow-dropdown">
          <div className="flex items-center gap-3 border-b border-line px-4 py-3.5">
            {AvatarCircle}
            <div className="min-w-0">
              <div className="truncate text-[13px] font-semibold text-navy">{name}</div>
              <div className="truncate text-[11.5px] text-content-secondary">
                {user?.email}
              </div>
            </div>
          </div>
          <div className="p-1.5">
            <Link
              to="/profile"
              onClick={() => setOpen(false)}
              className={cn(
                "block rounded-btn px-2.5 py-2 text-[13px] text-content-secondary transition-colors",
                "hover:bg-rowhover hover:text-navy",
              )}
            >
              Profile &amp; security
            </Link>
            <button
              type="button"
              onClick={handleSignOut}
              className="block w-full rounded-btn px-2.5 py-2 text-left text-[13px] text-content-secondary transition-colors hover:bg-rowhover hover:text-navy"
            >
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
