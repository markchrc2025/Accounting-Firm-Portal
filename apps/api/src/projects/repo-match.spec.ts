// repo-match.spec.ts — PA4 (D68): a webhook names a repository as owner/repo; a project names it by
// its repository address. They match when both mean the same GitHub repository.
import { normaliseRepo, sameRepo } from "./repo-match";

describe("PA4 · repository names", () => {
  it("reads owner/repo from the addresses people write, in lower case", () => {
    for (const url of [
      "https://github.com/Example-Org/Portal-App",
      "https://github.com/example-org/portal-app/",
      "https://github.com/example-org/portal-app.git",
      "http://github.com/example-org/portal-app",
      "https://www.github.com/example-org/portal-app",
      "https://github.com/example-org/portal-app/tree/main/src",
      "https://github.com/example-org/portal-app?tab=readme#top",
      "git@github.com:example-org/portal-app.git",
      "ssh://git@github.com/example-org/portal-app.git",
      "  https://github.com/example-org/portal-app  ",
      "example-org/portal-app",
      "Example-Org/Portal-App",
    ]) {
      expect(normaliseRepo(url)).toBe("example-org/portal-app");
    }
  });

  it("anything else is null: another host, no repository, junk, empty", () => {
    for (const bad of [
      "",
      "   ",
      "https://gitlab.com/example-org/portal-app",
      "https://github.com/example-org",
      "https://github.com/",
      "https://github.com",
      "not a url",
      "example-org",
      "a/b/c",
      "https://github.com.evil.test/example-org/portal-app",
      "https://evilgithub.com/example-org/portal-app",
    ]) {
      expect(normaliseRepo(bad)).toBeNull();
    }
  });

  it("sameRepo compares the two, and never matches when either is not a repository", () => {
    expect(sameRepo("https://github.com/Org/App.git", "org/app")).toBe(true);
    expect(sameRepo("https://github.com/org/app", "org/other")).toBe(false);
    expect(sameRepo("", "")).toBe(false);
    expect(sameRepo("junk", "junk")).toBe(false);
  });
});
