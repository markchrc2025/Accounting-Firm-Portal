// projects-repo-kit.service.ts — PA3 (D67): the files a code repository needs to work with a
// project (Track C's repoKit), made for this Portal's public API address. Never a token: the kit
// only names the environment variable the person puts their own token in.
import { ConflictException, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { repoKit, RepoKitError } from "@portal/projects-core";
import { ProjectsAccess, type ProjectsActor } from "./projects.access";
import { PROJECTS_PERMISSION as P } from "./projects.constants";

export const REPO_KIT_TOKEN_ENV = "PORTAL_PROJECTS_TOKEN";

/** What the request says about where it came from (set by the proxy in front of the API). */
export interface RequestOrigin {
  protocol: string;
  host: string | undefined;
  forwardedProto?: string | string[];
  forwardedHost?: string | string[];
}

const first = (v: string | string[] | undefined) =>
  (Array.isArray(v) ? v[0] : v)?.split(",")[0]?.trim() || undefined;

@Injectable()
export class ProjectsRepoKitService {
  constructor(
    private readonly access: ProjectsAccess,
    private readonly config: ConfigService,
  ) {}

  /** The Portal's address: API_PUBLIC_URL when set, otherwise what the request came to. */
  serverUrl(origin: RequestOrigin): string {
    const configured = (this.config.get<string>("API_PUBLIC_URL", "") ?? "").trim();
    if (configured) return configured.replace(/\/+$/, "");
    const proto = first(origin.forwardedProto) ?? origin.protocol;
    const host = first(origin.forwardedHost) ?? origin.host ?? "";
    return `${proto}://${host}`;
  }

  async kit(actor: ProjectsActor, key: string, origin: RequestOrigin) {
    await this.access.need(actor, P.read);
    const project = await this.access.project(actor.user, key);
    try {
      const input = {
        projectKey: project.key,
        serverUrl: this.serverUrl(origin),
        tokenEnvVar: REPO_KIT_TOKEN_ENV,
      };
      const files = repoKit(input);
      const serverUrl = new URL(input.serverUrl).origin;
      return {
        projectKey: project.key,
        serverUrl,
        tokenEnvVar: REPO_KIT_TOKEN_ENV,
        files,
      };
    } catch (e) {
      if (e instanceof RepoKitError) throw new ConflictException(e.message);
      throw e;
    }
  }
}
