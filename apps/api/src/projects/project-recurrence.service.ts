// project-recurrence.service.ts — PA8 (D70): recurring projects. A recurring project makes ONE task
// (an issue of type Task, in the default status, Normal, unassigned) for each occurrence, due on the
// occurrence date, a lead time before it (Daily 1 day, Weekly 7, Bi-Weekly 14, the others 30). The
// dates are projects-core's (PC5); the rules about them are in recurrence-plan.ts.
//
// Each generated occurrence is recorded once (unique on the project and the date), so a task the
// owner deleted is never made again and nothing is made twice, however many processes ask. Nothing
// before the day generation began is made, so a start date in the past does not flood the project.
// Generation runs when a project is created or changed, and once a day (gated by Redis, see
// recurrence-gate.ts) for every recurring project, which catches up any days that were missed.
import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from "@nestjs/common";
import { FREQUENCY_LABELS, isFrequency, type Frequency } from "@portal/projects-core";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";
import { IssueWrites } from "./issue-writes";
import { ProjectsAccess, systemActor } from "./projects.access";
import { dayOf, dayToDate, manilaToday } from "./projects.constants";
import { RecurrenceGate, type GateResult, type GateStore } from "./recurrence-gate";
import { datesToGenerate, occurrenceTitle } from "./recurrence-plan";

/** The Redis side of the gate. */
class RedisGateStore implements GateStore {
  constructor(private readonly redis: RedisService) {}
  available() {
    return this.redis.ping();
  }
  get(key: string) {
    return this.redis.client.get(key);
  }
  async set(key: string, value: string, ttlSeconds: number) {
    await this.redis.client.set(key, value, "EX", ttlSeconds);
  }
  async setNx(key: string, value: string, ttlSeconds: number) {
    return (await this.redis.client.set(key, value, "EX", ttlSeconds, "NX")) === "OK";
  }
  async delIfEquals(key: string, value: string) {
    await this.redis.client.eval(
      'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end',
      1,
      key,
      value,
    );
  }
}

export interface DailyResult {
  projects: number;
  created: number;
  errors: number;
}

const TICK_MS = 10 * 60 * 1000;
const FIRST_TICK_MS = 60 * 1000;

@Injectable()
export class ProjectRecurrenceService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger(ProjectRecurrenceService.name);
  private readonly gate: RecurrenceGate;
  private first: NodeJS.Timeout | null = null;
  private every: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectsAccess,
    private readonly writes: IssueWrites,
    redis: RedisService,
  ) {
    this.gate = new RecurrenceGate(new RedisGateStore(redis));
  }

  /** The daily run: shortly after start, then every ten minutes it asks whether today's run is done. */
  onApplicationBootstrap(): void {
    if (process.env.NODE_ENV === "test") return; // tests call runDaily themselves
    const tick = () =>
      this.runDaily()
        .then((r) => {
          if (!r.ran && r.reason === "no-redis") {
            this.log.warn(
              "Redis cannot be reached: the daily recurrence run was skipped.",
            );
          }
        })
        .catch((e: Error) =>
          this.log.warn(`The daily recurrence run failed: ${e.message}`),
        );
    this.first = setTimeout(tick, FIRST_TICK_MS);
    this.every = setInterval(tick, TICK_MS);
    this.first.unref();
    this.every.unref();
  }

  onModuleDestroy(): void {
    if (this.first) clearTimeout(this.first);
    if (this.every) clearInterval(this.every);
  }

  /**
   * The daily run, once a day across every API process: take the Redis lock, make what is due for
   * every recurring project that is not archived, record the day. `force` runs it again today.
   */
  runDaily(opts: { force?: boolean } = {}): Promise<GateResult<DailyResult>> {
    return this.gate.run(
      manilaToday(),
      async () => {
        const rows = await this.prisma.project.findMany({
          where: { isRecurring: true, archived: false },
          select: { id: true },
          orderBy: { createdAt: "asc" },
        });
        let created = 0;
        let errors = 0;
        for (const r of rows) {
          try {
            created += (await this.generateForProject(r.id)).created;
          } catch (e) {
            errors += 1;
            this.log.warn(
              `Recurrence for project ${r.id} failed: ${(e as Error).message}`,
            );
          }
        }
        return { ok: errors === 0, result: { projects: rows.length, created, errors } };
      },
      opts,
    );
  }

  /** Make the tasks that are due for one project. Safe to call at any time, from any process. */
  async generateForProject(projectId: string): Promise<{ created: number }> {
    const p = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        firmId: true,
        key: true,
        name: true,
        archived: true,
        isRecurring: true,
        recurrenceStart: true,
        recurrenceEnd: true,
        recurrenceFrequency: true,
        recurrenceActiveFrom: true,
      },
    });
    if (!p || !p.isRecurring || p.archived || !p.recurrenceStart) return { created: 0 };
    if (!isFrequency(p.recurrenceFrequency)) return { created: 0 };
    const frequency: Frequency = p.recurrenceFrequency;

    const due = datesToGenerate({
      start: dayOf(p.recurrenceStart)!,
      end: dayOf(p.recurrenceEnd),
      frequency,
      activeFrom: dayOf(p.recurrenceActiveFrom),
      today: manilaToday(),
    });
    if (due.length === 0) return { created: 0 };
    const have = new Set(
      (
        await this.prisma.projectOccurrence.findMany({
          where: {
            projectId: p.id,
            occurrenceDate: { in: due.map((d) => dayToDate(d)!) },
          },
          select: { occurrenceDate: true },
        })
      ).map((o) => dayOf(o.occurrenceDate)),
    );
    const todo = due.filter((d) => !have.has(d));
    if (todo.length === 0) return { created: 0 };

    await this.access.ensureDefaults(p.firmId);
    const types = await this.prisma.issueType.findMany({
      where: { firmId: p.firmId },
      orderBy: [{ order: "asc" }, { name: "asc" }],
    });
    const type = types.find((t) => t.name.toLowerCase() === "task") ?? types[0];
    const status = await this.prisma.issueStatus.findFirst({
      where: { firmId: p.firmId, isDefault: true },
    });
    if (!type || !status) {
      this.log.warn(
        `Project ${p.key}: no issue type or default status; nothing was made.`,
      );
      return { created: 0 };
    }
    const actor = systemActor(p.firmId);
    let created = 0;
    for (const date of todo) {
      await this.prisma.$transaction(async (tx) => {
        // claim the date first: a second process asking for it meets the unique key and stops
        const claimed = await tx.projectOccurrence.createMany({
          data: [{ firmId: p.firmId, projectId: p.id, occurrenceDate: dayToDate(date)! }],
          skipDuplicates: true,
        });
        if (claimed.count === 0) return;
        const issue = await this.writes.insert(tx, actor, p, {
          title: occurrenceTitle(p.name, frequency, date),
          description: `Made automatically by the recurring project ${p.key} (${FREQUENCY_LABELS[frequency]}), due ${date}.`,
          type,
          status,
          priority: "NORMAL",
          dueDate: date,
        });
        await tx.projectOccurrence.update({
          where: {
            projectId_occurrenceDate: {
              projectId: p.id,
              occurrenceDate: dayToDate(date)!,
            },
          },
          data: { issueId: issue.id },
        });
        created += 1;
      });
    }
    return { created };
  }
}
