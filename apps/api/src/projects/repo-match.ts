// repo-match.ts — PA4 (D68): a webhook names its repository as owner/repo; a project names it by
// the repository address in its settings. They are the same repository when both read as the same
// GitHub owner and name, in any letter case. Pure.

const NAME = /^[A-Za-z0-9][A-Za-z0-9-]*$/;
const REPO = /^[A-Za-z0-9._-]+$/;

function owned(owner: string | undefined, repo: string | undefined): string | null {
  if (!owner || !repo) return null;
  const name = repo.replace(/\.git$/i, "");
  if (!NAME.test(owner) || !REPO.test(name) || name === "." || name === "..") return null;
  return `${owner}/${name}`.toLowerCase();
}

/**
 * "owner/repo" in lower case from a GitHub address (https, http, git@, ssh://, with or without
 * .git, a trailing slash or deeper path) or from a bare "owner/repo"; null for anything else.
 */
export function normaliseRepo(value: string): string | null {
  const v = (value ?? "").trim();
  if (!v) return null;
  const scp = /^git@github\.com:([^/]+)\/([^/?#]+)$/i.exec(v);
  if (scp) return owned(scp[1], scp[2]);
  if (/^[^/:\s]+\/[^/:\s]+$/.test(v)) {
    const [owner, repo] = v.split("/");
    return owned(owner, repo);
  }
  let url: URL;
  try {
    url = new URL(v);
  } catch {
    return null;
  }
  if (!["https:", "http:", "ssh:"].includes(url.protocol)) return null;
  if (!/^(www\.)?github\.com$/i.test(url.hostname)) return null;
  const [owner, repo] = url.pathname.split("/").filter(Boolean);
  return owned(owner, repo);
}

/** True when both are GitHub repositories and the same one. */
export function sameRepo(a: string, b: string): boolean {
  const x = normaliseRepo(a);
  return x !== null && x === normaliseRepo(b);
}
