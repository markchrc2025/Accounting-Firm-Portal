// projects.schemas.ts — PA1 (D65): request shapes of the Projects API. The rules that need the
// database (a key already used, a status that is in use) are the services' and answer in
// sentences; these check the shape.
import { z } from "zod";
import {
  ACTOR_TYPES,
  CATEGORIES,
  ISSUE_SORTS,
  ISSUE_VIEWS,
  MILESTONE_STATES,
  PRIORITIES,
  PROJECT_STATUSES,
} from "../projects.constants";

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Dates must be written as YYYY-MM-DD.");
const optDay = day.nullable().optional();
const text = (max: number) => z.string().max(max);
const uuid = z.string().uuid();

export const CreateProjectSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1).max(200),
  description: text(20000).optional(),
  repoUrl: text(500).optional(),
  liveUrl: text(500).optional(),
  deployAppName: text(200).optional(),
  parentKey: z.string().nullable().optional(),
  clientId: uuid.nullable().optional(),
  /** PA8: any text up to 200 characters; a listed client's name is copied here when it is picked. */
  clientName: z.string().trim().max(200).nullable().optional(),
  /** PA8: checked by parseFee, so the refusal is one sentence whatever was sent. */
  professionalFee: z.unknown().optional(),
  categoryId: uuid.nullable().optional(),
  /**
   * PA8 (D70): recurrence. The frequency is one of projects-core's FREQUENCIES (DAILY, WEEKLY,
   * BI_WEEKLY, MONTHLY, QUARTERLY, ANNUALLY), checked with its isFrequency and its sentences, so the
   * schemas only take text.
   */
  isRecurring: z.boolean().optional(),
  recurrenceStart: z.string().nullable().optional(),
  /** Blank, null or missing: the schedule never ends. */
  recurrenceEnd: z.string().nullable().optional(),
  recurrenceFrequency: z.string().nullable().optional(),
});
export type CreateProjectInput = z.infer<typeof CreateProjectSchema>;

export const UpdateProjectSchema = z
  .object({
    /** Accepted only to refuse a change of it with a sentence. */
    key: z.string().optional(),
    name: z.string().min(1).max(200).optional(),
    description: text(20000).optional(),
    repoUrl: text(500).optional(),
    liveUrl: text(500).optional(),
    deployAppName: text(200).optional(),
    parentKey: z.string().nullable().optional(),
    clientId: uuid.nullable().optional(),
    clientName: z.string().trim().max(200).nullable().optional(),
    professionalFee: z.unknown().optional(),
    categoryId: uuid.nullable().optional(),
    /**
     * PA8 (D70): recurrence. The frequency is one of projects-core's FREQUENCIES (DAILY, WEEKLY,
     * BI_WEEKLY, MONTHLY, QUARTERLY, ANNUALLY), checked with its isFrequency and its sentences, so the
     * schemas only take text.
     */
    isRecurring: z.boolean().optional(),
    recurrenceStart: z.string().nullable().optional(),
    /** Blank, null or missing: the schedule never ends. */
    recurrenceEnd: z.string().nullable().optional(),
    recurrenceFrequency: z.string().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "At least one field is required",
  });
export type UpdateProjectInput = z.infer<typeof UpdateProjectSchema>;

export const ProjectListQuerySchema = z.object({
  includeArchived: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
  /** PA8: a category id, or "none" for projects without one. */
  categoryId: z.union([uuid, z.literal("none")]).optional(),
});

export const PostStatusSchema = z.object({
  status: z.enum(PROJECT_STATUSES),
  note: text(2000).default(""),
});
export type PostStatusInput = z.infer<typeof PostStatusSchema>;

const intQuery = (min: number, max: number, dflt: number) =>
  z
    .string()
    .regex(/^\d+$/)
    .optional()
    .transform((v) => (v === undefined ? dflt : Math.min(max, Math.max(min, Number(v)))));

export const IssueListQuerySchema = z.object({
  q: z.string().max(200).optional(),
  view: z.enum(ISSUE_VIEWS).optional(),
  state: z.enum(["open", "closed", "all"]).optional(),
  statusId: uuid.optional(),
  typeId: uuid.optional(),
  assigneeId: z.union([uuid, z.literal("none"), z.literal("me")]).optional(),
  milestoneId: z.union([uuid, z.literal("none")]).optional(),
  labelId: uuid.optional(),
  priority: z.enum(PRIORITIES).optional(),
  sort: z.enum(ISSUE_SORTS).optional(),
  limit: intQuery(1, 500, 200),
  offset: intQuery(0, 1_000_000, 0),
});
export type IssueListQuery = z.infer<typeof IssueListQuerySchema>;

export const CreateIssueSchema = z.object({
  title: z.string().min(1).max(300),
  description: text(100000).optional(),
  typeId: uuid.optional(),
  statusId: uuid.optional(),
  priority: z.enum(PRIORITIES).optional(),
  assigneeId: uuid.nullable().optional(),
  milestoneId: uuid.nullable().optional(),
  parentKey: z.string().nullable().optional(),
  startDate: optDay,
  dueDate: optDay,
  labelIds: z.array(uuid).max(50).optional(),
});
export type CreateIssueInput = z.infer<typeof CreateIssueSchema>;

/** Quick create: the title and nothing else. */
export const QuickIssueSchema = z.object({ title: z.string().min(1).max(300) }).strict();

export const UpdateIssueSchema = z
  .object({
    title: z.string().min(1).max(300).optional(),
    description: text(100000).optional(),
    typeId: uuid.optional(),
    statusId: uuid.optional(),
    priority: z.enum(PRIORITIES).optional(),
    assigneeId: uuid.nullable().optional(),
    milestoneId: uuid.nullable().optional(),
    parentKey: z.string().nullable().optional(),
    startDate: optDay,
    dueDate: optDay,
    labelIds: z.array(uuid).max(50).optional(),
    position: z.number().finite().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "At least one field is required",
  });
export type UpdateIssueInput = z.infer<typeof UpdateIssueSchema>;

export const ReorderIssueSchema = z.object({
  position: z.number().finite(),
  statusId: uuid.optional(),
});
export type ReorderIssueInput = z.infer<typeof ReorderIssueSchema>;

export const CommentSchema = z.object({ body: z.string().max(100000) });

export const CreateMilestoneSchema = z.object({
  name: z.string().min(1).max(200),
  description: text(20000).optional(),
  startDate: optDay,
  dueDate: optDay,
});
export const UpdateMilestoneSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    description: text(20000).optional(),
    startDate: optDay,
    dueDate: optDay,
    state: z.enum(MILESTONE_STATES).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "At least one field is required",
  });

export const ActivityQuerySchema = z.object({
  actorType: z.enum(ACTOR_TYPES).optional(),
  page: intQuery(1, 100000, 1),
  pageSize: intQuery(1, 100, 25),
});

/** GET /projects/:key/recurrence-preview (PA8): how many dates, and an unsaved schedule to preview. */
export const RecurrencePreviewQuerySchema = z.object({
  count: z.string().optional(),
  start: z.string().optional(),
  end: z.string().optional(),
  frequency: z.string().optional(),
});

/** GET /projects/:key/sessions (PA5) */
export const SessionsQuerySchema = z.object({
  page: intQuery(1, 100000, 1),
  pageSize: intQuery(1, 100, 25),
});

const colour = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "The colour must look like #1a7f37.");
export const IssueTypeSchema = z.object({
  name: z.string().min(1).max(60),
  colour: colour.optional(),
  order: z.number().int().min(0).max(1000).optional(),
});
export const UpdateIssueTypeSchema = IssueTypeSchema.partial().refine(
  (v) => Object.keys(v).length > 0,
  { message: "At least one field is required" },
);
/** PA8 (D70): a project category, edited like an issue type. */
export const ProjectCategorySchema = IssueTypeSchema;
export const UpdateProjectCategorySchema = UpdateIssueTypeSchema;
export const IssueStatusSchema = z.object({
  name: z.string().min(1).max(60),
  colour: colour.optional(),
  order: z.number().int().min(0).max(1000).optional(),
  category: z.enum(CATEGORIES),
  isDefault: z.boolean().optional(),
});
export const UpdateIssueStatusSchema = IssueStatusSchema.partial().refine(
  (v) => Object.keys(v).length > 0,
  { message: "At least one field is required" },
);
export const LabelSchema = z.object({
  name: z.string().min(1).max(60),
  colour: colour.optional(),
});
export const UpdateLabelSchema = LabelSchema.partial().refine(
  (v) => Object.keys(v).length > 0,
  { message: "At least one field is required" },
);

export const BoardQuerySchema = z.object({
  milestoneId: z.union([uuid, z.literal("none")]).optional(),
  assigneeId: z.union([uuid, z.literal("none"), z.literal("me")]).optional(),
  doneRange: z.enum(["14d", "all"]).default("14d"),
});
export type BoardQuery = z.infer<typeof BoardQuerySchema>;

export const SearchQuerySchema = z.object({
  q: z.string().trim().min(1, "Type something to search for.").max(200),
});

// ---- PA4 (D68): checklist import and security audits -------------------------------------------

export const ChecklistImportSchema = z.object({
  markdown: z.string().min(1).max(1_000_000),
  headingsAsMilestones: z.boolean().default(false),
  dryRun: z.boolean().default(false),
});
export type ChecklistImportBody = z.infer<typeof ChecklistImportSchema>;

/** run-metadata.json: the fields the helpers read (the file has more, which are ignored). */
const AuditRunSchema = z
  .object({
    run_id: z.string().max(200).optional(),
    source_ref: z.string().max(200).optional(),
    profile: z.string().max(40).optional(),
    scope_paths: z.array(z.string().max(500)).max(1000).optional(),
    run_status: z.string().max(40).optional(),
    incomplete_reason: z.string().max(1000).optional(),
  })
  .passthrough();

export const AuditImportSchema = z.object({
  /** findings.json: the array, or the text of the file. */
  findings: z.union([z.array(z.unknown()), z.string()]),
  run: AuditRunSchema.optional(),
  /** coverage-ledger.json: the array of units. */
  ledger: z.array(z.unknown()).optional(),
  /** Ledger counts already made, by status; used when there is no ledger. */
  coverage: z.record(z.unknown()).optional(),
});
export type AuditImportBody = z.infer<typeof AuditImportSchema>;

export const AuditListQuerySchema = z.object({ limit: intQuery(1, 100, 50) });
