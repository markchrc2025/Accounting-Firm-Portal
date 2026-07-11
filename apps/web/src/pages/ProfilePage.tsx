import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  deleteAvatar,
  fetchProfile,
  updateProfile,
  uploadAvatar,
  type Profile,
} from "../lib/api";
import { useAuth } from "../auth/AuthContext";
import {
  Button,
  Card,
  CardContent,
  Chip,
  ErrorState,
  PageHeader,
  Skeleton,
} from "../components/ui";

/** Accepted avatar MIME types + the max upload size the API enforces. */
const AVATAR_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

/** Two-letter monogram from a full name ("Maria Cruz" → "MC"). */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = words[0]?.[0] ?? "";
  const second = words.length > 1 ? (words[words.length - 1]?.[0] ?? "") : "";
  return (first + second).toUpperCase() || "?";
}

/** Human-readable message from any thrown error. */
function errMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return fallback;
}

export default function ProfilePage() {
  const profile = useQuery({ queryKey: ["profile"], queryFn: () => fetchProfile() });

  return (
    <div className="max-w-[720px] animate-fade-rise">
      <PageHeader
        title="Profile & security"
        eyebrow="YOUR ACCOUNT"
        description="Manage your name, photo, and sign-in security."
      />

      {profile.isPending && (
        <div className="space-y-4">
          <Skeleton className="h-40 w-full rounded-card" />
          <Skeleton className="h-44 w-full rounded-card" />
          <Skeleton className="h-32 w-full rounded-card" />
        </div>
      )}

      {profile.isError && (
        <Card>
          <ErrorState
            message="Could not load your profile."
            onRetry={() => void profile.refetch()}
          />
        </Card>
      )}

      {profile.data && (
        <div className="space-y-5">
          <AvatarCard profile={profile.data} />
          <DetailsCard profile={profile.data} />
          <SecurityCard profile={profile.data} />
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- Upload ring */

/**
 * A circular progress overlay drawn on the border of the avatar. `progress` is
 * 0–100 while bytes upload, or -1 once they're sent and the server is finishing
 * (rendered as a slow indeterminate spin). Sits on top of the 96px avatar.
 */
function UploadRing({ progress }: { progress: number }) {
  const size = 96;
  const stroke = 4;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const indeterminate = progress < 0;
  const pct = indeterminate ? 25 : Math.max(0, Math.min(100, progress));
  const dash = (pct / 100) * circumference;

  return (
    <div className="absolute inset-0 flex items-center justify-center">
      {/* Dim the photo so the ring + label read clearly. */}
      <div className="absolute inset-0 rounded-full bg-navy/45" />
      <svg
        className={indeterminate ? "absolute inset-0 animate-spin" : "absolute inset-0 -rotate-90"}
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="rgba(255,255,255,0.25)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="#c0902f"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference}`}
        />
      </svg>
      {!indeterminate && (
        <span className="relative font-mono text-[15px] font-semibold text-white">
          {pct}%
        </span>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- Avatar card */

function AvatarCard({ profile }: { profile: Profile }) {
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  // Upload progress: null = idle, 0–100 = sending bytes, -1 = server processing.
  const [progress, setProgress] = useState<number | null>(null);

  const upload = useMutation({
    mutationFn: (file: File) => {
      setProgress(0);
      return uploadAvatar(file, setProgress);
    },
    onSuccess: () => {
      setError(null);
      setProgress(null);
      void qc.invalidateQueries({ queryKey: ["profile"] });
    },
    onError: (err) => {
      setProgress(null);
      setError(errMessage(err, "Could not upload that photo."));
    },
  });

  const remove = useMutation({
    mutationFn: () => deleteAvatar(),
    onSuccess: () => {
      setError(null);
      void qc.invalidateQueries({ queryKey: ["profile"] });
    },
    onError: (err) => setError(errMessage(err, "Could not remove your photo.")),
  });

  function onPick(file: File | null) {
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (!file) return;
    setError(null);
    const okType = (AVATAR_TYPES as readonly string[]).includes(file.type);
    if (!okType) {
      setError("Please choose a PNG, JPEG, or WebP image.");
      return;
    }
    if (file.size > AVATAR_MAX_BYTES) {
      setError("That image is larger than 5 MB — please choose a smaller file.");
      return;
    }
    upload.mutate(file);
  }

  const busy = upload.isPending || remove.isPending;

  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="eyebrow">Profile photo</div>

        <div className="flex flex-wrap items-center gap-5">
          <div className="relative h-24 w-24 flex-none">
            {profile.avatarUrl ? (
              <img
                src={profile.avatarUrl}
                alt="Your profile photo"
                className="h-24 w-24 rounded-full border border-line-strong object-cover"
              />
            ) : (
              <span
                aria-hidden
                className="flex h-24 w-24 items-center justify-center rounded-full bg-navy font-mono text-2xl font-semibold text-gold-soft"
              >
                {initials(profile.fullName)}
              </span>
            )}
            {progress !== null && <UploadRing progress={progress} />}
          </div>

          <div className="min-w-0 space-y-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => onPick(e.target.files?.[0] ?? null)}
              />
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => fileInputRef.current?.click()}
              >
                Upload photo
              </Button>
              {profile.avatarUrl && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => remove.mutate()}
                >
                  Remove photo
                </Button>
              )}
              {upload.isPending && (
                <span className="text-[12.5px] text-content-secondary">
                  {progress !== null && progress >= 0
                    ? `Uploading… ${progress}%`
                    : "Finishing up…"}
                </span>
              )}
              {remove.isPending && (
                <span className="text-[12.5px] text-content-secondary">Removing…</span>
              )}
            </div>
            <p className="text-[12.5px] text-content-muted">
              PNG, JPEG, or WebP · up to 5 MB.
            </p>
          </div>
        </div>

        {error && (
          <div className="rounded-input border border-danger/30 bg-danger-bg px-3.5 py-2.5 text-[13px] text-danger-ink">
            {error}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* --------------------------------------------------------------- Details card */

function DetailsCard({ profile }: { profile: Profile }) {
  const qc = useQueryClient();
  const { refreshUser } = useAuth();
  const [fullName, setFullName] = useState(profile.fullName);
  const [saved, setSaved] = useState(false);

  // Re-seed the local field if the profile is refetched to a new name.
  useEffect(() => {
    setFullName(profile.fullName);
  }, [profile.fullName]);

  const save = useMutation({
    mutationFn: (name: string) => updateProfile({ fullName: name }),
    onSuccess: () => {
      setSaved(true);
      void qc.invalidateQueries({ queryKey: ["profile"] });
      // Refresh the auth session so the name updates everywhere it's shown
      // (dashboard greeting, top-bar menu) without a re-login.
      void refreshUser();
    },
  });

  // Clear the transient "Saved" note shortly after it appears.
  useEffect(() => {
    if (!saved) return;
    const t = window.setTimeout(() => setSaved(false), 2500);
    return () => window.clearTimeout(t);
  }, [saved]);

  const trimmed = fullName.trim();
  const unchanged = trimmed === profile.fullName.trim();
  const disabled = save.isPending || unchanged || trimmed === "";

  return (
    <Card>
      <CardContent className="space-y-5">
        <div className="eyebrow">Account details</div>

        <label className="block">
          <span className="text-[13px] font-semibold text-content">Full name</span>
          <div className="mt-1.5">
            <input
              value={fullName}
              onChange={(e) => {
                setFullName(e.target.value);
                setSaved(false);
              }}
              className="input"
              placeholder="Your name"
            />
          </div>
        </label>

        <label className="block">
          <span className="text-[13px] font-semibold text-content">Email</span>
          <div className="mt-1.5">
            <input
              value={profile.email}
              readOnly
              disabled
              className="input font-mono text-content-secondary"
            />
          </div>
        </label>

        {save.isError && (
          <div className="rounded-input border border-danger/30 bg-danger-bg px-3.5 py-2.5 text-[13px] text-danger-ink">
            {errMessage(save.error, "Could not save your name.")}
          </div>
        )}

        <div className="flex items-center gap-3">
          <Button
            disabled={disabled}
            onClick={() => save.mutate(trimmed)}
          >
            {save.isPending ? "Saving…" : "Save"}
          </Button>
          {saved && !save.isPending && (
            <span className="text-[12.5px] font-semibold text-success">Saved</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------- Security card */

function SecurityCard({ profile }: { profile: Profile }) {
  // Surface the signed-in user for context; status comes from the profile itself.
  useAuth();
  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="eyebrow">Sign-in security</div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-serif text-[15px] font-medium text-navy">
              Multi-factor authentication
            </div>
            <p className="mt-1 text-[12.5px] text-content-secondary">
              Multi-factor authentication is required for all MCRC accounts.
            </p>
          </div>
          {profile.mfaEnabled ? (
            <Chip variant="success">Enrolled</Chip>
          ) : (
            <Chip variant="warn">Not enrolled</Chip>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
