// mcp-bir-tools.ts — U20 (D60): the connector's BIR-form tools. They DRAFT: the connector
// never files, never seals, never uploads a BIR confirmation, never deletes a return and
// never makes the clear (final) copy. Filing stays in the web, because it needs the BIR
// confirmation e-mail (U18).
//
// Every answer carries `needs`: plain questions Claude puts to the owner (needs.ts). The
// rules are the Portal's own: each tool goes through BirFormsService, so permissions, the
// seal, the validators and the audit rows are the web's, applied to the acting user.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ConflictException } from "@nestjs/common";
import type { Client } from "@prisma/client";
import { z } from "zod/v3";
import type { AuthUser } from "../../common/auth/auth-user";
import type { AuditService } from "../../audit/audit.service";
import type { ClientsService } from "../../clients/clients.service";
import type { PrismaService } from "../../prisma/prisma.service";
import type { AlphalistService } from "../../bir-forms/alphalist/alphalist.service";
import type { BirFormsService } from "../../bir-forms/bir-forms.service";
import { CONFIRMATION_FORMS } from "../../bir-confirmation/confirmation-forms";
import { PAYOR_NAME_MISSING } from "../../bir-forms/engine/certificate2307";
import type { FilingData } from "../../bir-forms/engine/types";
import type { BookFigures } from "../../bir-forms/book-figures/book-figures.service";
import type { BookFiguresService } from "../../bir-forms/book-figures/book-figures.service";
import { PREVIEW_FILED, sealedMessage } from "../../bir-forms/bir-forms.service";
import { errMsg, fail, ok, READ_ONLY, WRITE_CREATE, WRITE_MUTATE } from "../mcp-common";
import {
  BOOKS_FED,
  birFormTypes,
  daysLeft,
  dueDateOf,
  periodFrom,
  type BirFormType,
} from "./bir-form-types";
import { manilaToday } from "./clock";
import { matchClients, nearMatches, optionText, type ClientRow } from "./client-ref";
import { chooseDefaultPeriod, type ChosenPeriod } from "./default-period";
import { dueItems, formsFor, type ExistingReturns } from "./forms-due";
import { BIR_KEY_LINE } from "./instructions";
import { filedSnapshotOf, printsOf } from "./prints";
import {
  alphalistNeeds,
  choiceNeeds,
  clientNeeds,
  noRecordsNeed,
  refusalNeed,
  typedNeeds,
  type ClientFacts,
  type Need,
} from "./needs";

export interface McpBirDeps {
  prisma: PrismaService;
  audit: AuditService;
  clients: ClientsService;
  birForms: BirFormsService;
  bookFigures: BookFiguresService;
  alphalists: AlphalistService;
  /** The principal the tools act as; the services check its permissions. */
  getActor: () => Promise<AuthUser>;
}

/** The form items the three withholding returns label (the other forms' items are numbered only). */
const LABELS: Record<string, Record<string, string>> = {
  "0619E": {
    i14: "Amount of remittance",
    i15: "Less: amount remitted from the previously filed return (amended return)",
    i16: "Net amount of remittance",
    i17a: "Surcharge",
    i17b: "Interest",
    i17c: "Compromise",
    i17d: "Total penalties",
    i18: "Total amount of remittance",
  },
  "1601EQ": {
    i19: "Total taxes withheld for the quarter",
    i20: "Tax remitted in the 0619-E for the 1st month",
    i21: "Tax remitted in the 0619-E for the 2nd month",
    i22: "Tax remitted in the return previously filed (amended return)",
    i23: "Over-remittance carried over from the previous quarter",
    i24: "Other payments made",
    i25: "Total remittances made",
    i26: "Tax still due / (over-remittance)",
    i27: "Surcharge",
    i28: "Interest",
    i29: "Compromise",
    i30: "Total penalties",
    i31: "Total amount still due / (over-remittance)",
  },
  "1601C": {
    i14: "Total amount of compensation",
    i21: "Total non-taxable compensation",
    i22: "Total taxable compensation",
    i23: "Taxable compensation not subject to withholding",
    i24: "Net taxable compensation",
    i25: "Taxes withheld",
    i26: "Adjustment (Schedule I total)",
    i27: "Taxes withheld for remittance",
    i28: "Tax remitted in the return previously filed (amended return)",
    i29: "Other remittances made",
    i30: "Total tax remittances made",
    i31: "Tax still due / (over-remittance)",
    i32: "Surcharge",
    i33: "Interest",
    i34: "Compromise",
    i35: "Total penalties",
    i36: "Total amount still due / (over-remittance)",
  },
};

const asFacts = (c: Client): ClientFacts => c;
const fiscalStart = (c: Client) =>
  c.fiscalYearStart ? c.fiscalYearStart.toISOString().slice(0, 10) : null;

/** The computed figures with their item numbers and labels; what is not an item goes to `other`. */
function computedItems(form: string, computed: unknown) {
  const items: Array<{
    item: string;
    key: string;
    label: string | null;
    value: unknown;
  }> = [];
  const other: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(
    (computed ?? {}) as Record<string, unknown>,
  )) {
    const m = /^i(\d+)([a-z]?)$/i.exec(key);
    if (m)
      items.push({
        item: `${m[1]}${m[2]!.toUpperCase()}`,
        key,
        label: LABELS[form]?.[key] ?? null,
        value,
      });
    else other[key] = value;
  }
  return { items, other };
}

/** The data every draft of a form starts with: the period's year (and month or quarter) as the web writes them. */
function startingData(form: string, period: string): Record<string, unknown> {
  const data: Record<string, unknown> = { year: period.slice(0, 4) };
  if (form === "1601EQ")
    data.quarter = ["1st", "2nd", "3rd", "4th"][Number(period.slice(-1)) - 1];
  if (form === "0619E" || form === "1601C") data.month = period.slice(5, 7);
  return data;
}

const clientShape = {
  client: z
    .string()
    .optional()
    .describe(
      "The client the owner names: its registered name, trade name or business name (case and punctuation do not matter), or its TIN. Pass what the owner said; never ask for an id.",
    ),
  clientId: z
    .string()
    .uuid()
    .optional()
    .describe("Client id from portal_list_clients, if you already have it"),
};

const periodShape = {
  ...clientShape,
  formCode: z
    .string()
    .min(1)
    .describe("BIR form code from portal_list_bir_form_types, e.g. 1601EQ"),
  year: z
    .number()
    .int()
    .optional()
    .describe(
      "The year of the return, e.g. 2026. Leave out year, quarter and month to use the period due next (the answer's periodChoice says which).",
    ),
  quarter: z.number().int().optional().describe("1 to 4, for a quarterly form"),
  month: z.number().int().optional().describe("1 to 12, for a monthly form"),
};

export function registerBirTools(server: McpServer, deps: McpBirDeps): void {
  const { prisma, audit, clients, birForms, bookFigures, alphalists, getActor } = deps;

  /** One audit row per connector write, beside the service's own (the usual trail). */
  async function recordMcpWrite(
    actor: AuthUser,
    tool: string,
    entityId: string | null,
    metadata: Record<string, unknown> = {},
  ) {
    await audit.record({
      userId: actor.id,
      action: `mcp.${tool}`,
      entityType: "BirForm",
      entityId,
      metadata: {
        firmId: actor.firmId,
        actor: "Claude (MCP)",
        source: "mcp",
        ...metadata,
      },
    });
  }

  async function loadClient(actor: AuthUser, clientId: string): Promise<Client> {
    const row = await prisma.client.findFirst({
      where: { id: clientId, firmId: actor.firmId },
    });
    if (!row) {
      throw new Error(
        `Client ${clientId} was not found. Call portal_list_clients to look up valid client ids.`,
      );
    }
    return row;
  }

  type Resolved =
    | { ok: true; client: Client; matchedBy: "id" | "name" | "tin" }
    | { ok: false; answer: Record<string, unknown> };

  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  /** The client the owner named: one client, or the question that settles which (U20b, D61). */
  async function resolveClient(
    actor: AuthUser,
    args: { client?: string | undefined; clientId?: string | undefined },
  ): Promise<Resolved> {
    if (args.clientId)
      return {
        ok: true,
        client: await loadClient(actor, args.clientId),
        matchedBy: "id",
      };
    const ref = (args.client ?? "").trim();
    if (ref === "") throw new Error("Give client (a name or TIN) or clientId.");
    if (UUID.test(ref))
      return { ok: true, client: await loadClient(actor, ref), matchedBy: "id" };
    const rows = await prisma.client.findMany({
      where: { firmId: actor.firmId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        businessName: true,
        regName: true,
        tradeName: true,
        tin: true,
        status: true,
      },
    });
    const m = matchClients(rows as ClientRow[], ref);
    if (m.rows.length === 1) {
      return {
        ok: true,
        client: await loadClient(actor, m.rows[0]!.id),
        matchedBy: m.by,
      };
    }
    if (m.rows.length === 0) {
      // U20c: not an exact match; offer the near ones (never pick one, write nothing).
      const near = nearMatches(rows as ClientRow[], ref);
      if (near.total > 0) {
        const more = near.total - near.rows.length;
        return {
          ok: false,
          answer: {
            client: null,
            matchedBy: null,
            needs: [
              {
                key: "client",
                question: "Which client do you mean?",
                why:
                  more > 0
                    ? "No client has exactly that name; these are the closest, and there are more than can be listed. Give a longer name or a TIN."
                    : "No client has exactly that name; these are the closest, and a BIR form is drafted for one.",
                setWith:
                  "this tool again, with client set to the TIN of the one meant (or clientId)",
                kind: "choice",
                options: near.rows.map(optionText),
                refs: { clientIds: near.rows.map((r) => r.id) },
              } satisfies Need,
            ],
            notes:
              more > 0
                ? [
                    `${near.total} clients match; these are the first ${near.rows.length} by name. ${more} more match: give a longer name or a TIN.`,
                  ]
                : [],
          },
        };
      }
    }
    const need: Need =
      m.rows.length === 0
        ? {
            key: "client",
            question: `I could not find a client named ${ref}. What is the registered name or TIN?`,
            why: "A BIR form is drafted for one client.",
            setWith: "this tool again, with client set to the registered name or TIN",
            kind: "text",
          }
        : {
            key: "client",
            question: "Which client do you mean?",
            why: "More than one client has that name or TIN, and a BIR form is drafted for one.",
            setWith:
              "this tool again, with client set to the TIN of the one meant (or clientId)",
            kind: "choice",
            options: m.rows.map(optionText),
            refs: { clientIds: m.rows.map((r) => r.id) },
          };
    return {
      ok: false,
      answer: { client: null, matchedBy: null, needs: [need], notes: [] },
    };
  }

  /** What the answer says of the client it found. */
  const clientEcho = (c: Client) => ({ id: c.id, name: c.businessName, tin: c.tin });
  const inactiveNote = (c: Client) =>
    c.status === "ACTIVE" ? [] : [`${c.businessName} is ${c.status} (inactive).`];

  /** The period named, or the one due next (the answer says which and why). */
  async function resolvePeriod(
    actor: AuthUser,
    client: Client,
    args: {
      formCode: string;
      year?: number | undefined;
      quarter?: number | undefined;
      month?: number | undefined;
    },
  ): Promise<{ period: string; choice: ChosenPeriod | null } | { error: string }> {
    if (
      args.year === undefined &&
      args.quarter === undefined &&
      args.month === undefined
    ) {
      if (!typeOf(args.formCode))
        return { error: `Form ${args.formCode} is not available yet.` };
      const rows = await prisma.birForm.findMany({
        where: {
          firmId: actor.firmId,
          clientId: client.id,
          form: args.formCode,
          status: "filed",
        },
        select: { period: true },
      });
      const done = new Set(rows.map((r) => r.period));
      const chosen = chooseDefaultPeriod(
        args.formCode,
        manilaToday(),
        fiscalStart(client),
        (p) => done.has(p),
      );
      if (!chosen) {
        return {
          error: `No period could be chosen for the ${args.formCode}. Give year and quarter or month.`,
        };
      }
      return { period: chosen.period, choice: chosen };
    }
    if (args.year === undefined) return { error: "Give year with the quarter or month." };
    const p = periodFrom(args.formCode, {
      year: args.year,
      quarter: args.quarter,
      month: args.month,
    });
    return "error" in p ? p : { period: p.period, choice: null };
  }

  const typeOf = (form: string): BirFormType | undefined =>
    birFormTypes().find((t) => t.code === form);

  /** The books' figures for a draft's period, or why there are none. Never throws. */
  async function booksFor(
    actor: AuthUser,
    clientId: string,
    form: string,
    period: string,
  ) {
    if (!BOOKS_FED.has(form))
      return { figures: null as BookFigures | null, problem: null as string | null };
    try {
      return {
        figures: await bookFigures.figures(actor, { clientId, form, period }),
        problem: null,
      };
    } catch (err) {
      return { figures: null, problem: errMsg(err) };
    }
  }

  /** Every question still open for a draft, from the Portal's own sources. */
  async function needsFor(
    actor: AuthUser,
    f: {
      id: string | null;
      form: string;
      period: string;
      data: Record<string, unknown>;
      previewAvailable: boolean;
    },
    client: Client,
    books: { figures: BookFigures | null; problem: string | null },
    alphalist: Awaited<ReturnType<AlphalistService["inspect"]>> | null,
  ) {
    const notes: string[] = [];
    const warnings: string[] = [...(books.figures?.warnings ?? [])];
    if (books.problem) notes.push(books.problem);
    const needs: Need[] = [
      ...clientNeeds(f.form, asFacts(client), f.data),
      ...typedNeeds(f.form, f.data as unknown as FilingData),
      ...choiceNeeds(f.form, f.data as unknown as FilingData, f.period),
    ];
    if (BOOKS_FED.has(f.form) && books.figures && books.figures.recordCount === 0) {
      needs.push(noRecordsNeed(f.form, true));
      notes.push("The Portal has no posted records for this period.");
    }
    if (alphalist) {
      const rdoMissing = needs.some((n) => n.key === "client.rdo");
      const refusals = alphalist.check.refusals.filter(
        (r) =>
          r !== "The alphalist has no payees to list." &&
          !(rdoMissing && r === "Add the client's RDO code before making the alphalist."),
      );
      needs.push(...alphalistNeeds(alphalist.payeeNeeds ?? [], refusals));
    }
    // What the Preview PDF would refuse today, in the Portal's own words.
    if (f.id && f.previewAvailable) {
      try {
        await birForms.previewPdf(actor, f.id);
      } catch (err) {
        if (err instanceof ConflictException) {
          const sentence = errMsg(err);
          const covered =
            needs.some((n) => n.question === sentence || n.why === sentence) ||
            (sentence === PAYOR_NAME_MISSING &&
              needs.some((n) => n.key.startsWith("client.")));
          if (!covered)
            needs.push(
              refusalNeed(
                sentence,
                needs.filter((n) => n.key.startsWith("refusal.")).length,
              ),
            );
        } else notes.push("The preview could not be tested just now.");
      }
    }
    return { needs, warnings, notes };
  }

  /** The answer of portal_get_bir_form: a return as it stands. */
  async function view(actor: AuthUser, id: string, extra: Record<string, unknown> = {}) {
    const d = (await birForms.getOne(actor, id)) as unknown as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- the detail view
    const client = await loadClient(actor, d.clientId);
    const form = d.form as string;
    const data = (d.data ?? {}) as Record<string, unknown>;
    const draft = d.status === "draft";
    const books = draft
      ? await booksFor(actor, client.id, form, d.period)
      : { figures: null, problem: null };
    const alphalist =
      draft && form === "1601EQ"
        ? await birForms.alphalistOutcome(actor, id).catch(() => null)
        : null;
    const open = draft
      ? await needsFor(
          actor,
          {
            id,
            form,
            period: d.period,
            data,
            previewAvailable: Boolean(d.previewAvailable),
          },
          client,
          books,
          alphalist,
        )
      : { needs: [] as Need[], warnings: [] as string[], notes: [] as string[] };
    const due = dueDateOf(form, d.period, fiscalStart(client));
    const { items, other } = computedItems(form, d.computed);
    const confirmation = d.confirmation as {
      kind: string;
      birFileName: string | null;
      receivedAt: string | null;
    } | null;
    return {
      id,
      ...extra,
      form,
      formName: typeOf(form)?.name ?? form,
      figures: BOOKS_FED.has(form) ? "books" : "typed",
      client: clientEcho(client),
      period: d.period,
      status: d.status,
      dueDate: due,
      daysLeft: due ? daysLeft(due, manilaToday()) : null,
      data,
      computed: items,
      computedOther: other,
      warnings: open.warnings,
      notes: open.notes,
      needs: open.needs,
      // U24: the contact number and e-mail this return prints
      prints: printsOf(form, data, client, filedSnapshotOf(d.filedSnapshot)),
      filed:
        d.status === "filed"
          ? {
              filedAt: d.filedAt,
              confirmation: {
                status: !CONFIRMATION_FORMS.has(form)
                  ? "not required"
                  : confirmation
                    ? confirmation.kind === "override"
                      ? "filed without BIR confirmation"
                      : "confirmed"
                    : "no BIR confirmation attached",
                birFileName: confirmation?.birFileName ?? null,
                receivedAt: confirmation?.receivedAt ?? null,
              },
            }
          : null,
      alphalist: d.alphalist ?? null,
    };
  }

  /** Update the draft's data like the web does, but merged: the supplied keys replace, null clears. */
  function mergeData(
    current: Record<string, unknown>,
    patch: Record<string, unknown>,
  ): Record<string, unknown> {
    const next: Record<string, unknown> = { ...current };
    const touched: string[] = [];
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) delete next[k];
      else next[k] = v;
      touched.push(k);
    }
    const src = next._source as
      { mode?: string; fed?: Record<string, unknown>; edited?: string[] } | undefined;
    if (src && src.mode === "books" && src.fed && Array.isArray(src.edited)) {
      const edited = new Set(src.edited);
      for (const k of touched) if (k in src.fed) edited.add(k);
      next._source = { ...src, edited: [...edited] };
    }
    return next;
  }

  // ---------------------------------------------------------------------------------------
  server.registerTool(
    "portal_list_bir_form_types",
    {
      title: "List the BIR forms the Portal can draft",
      description:
        "The BIR forms this connector can draft: code, name, period kind (month, quarter or year), whether the " +
        "figures come from the client's posted records (books) or are typed, and the due-date rule. No input. " +
        "Drafts only: filing is done in the Portal with the BIR confirmation email.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => ok({ forms: birFormTypes() }),
  );

  server.registerTool(
    "portal_bir_form_requirements",
    {
      title: "What a BIR form draft still needs",
      description:
        `FIRST CALL for any BIR draft. ${BIR_KEY_LINE} ` +
        "A read-only dry run for a client, form and period: the period, whether a draft or filed return already " +
        "exists (with its id), the figures it would compute today, warnings, and `needs` — plain questions for the " +
        "owner, each with why it is asked, the tool and field that writes the answer (setWith), the kind of answer " +
        "and any options. Figures from posted records are never needs. Writes nothing.",
      inputSchema: periodShape,
      annotations: READ_ONLY,
    },
    async (args) => {
      try {
        const actor = await getActor();
        const found = await resolveClient(actor, args);
        if (!found.ok) return ok(found.answer);
        const client = found.client;
        const p = await resolvePeriod(actor, client, args);
        if ("error" in p) return fail(p.error);
        const echo = { matchedBy: found.matchedBy, periodChoice: p.choice };
        const existing = await birForms.findForPeriod(
          actor,
          client.id,
          args.formCode,
          p.period,
        );
        const target = existing.draft ?? existing.filed;
        if (target) {
          const v = await view(actor, target.id, {
            exists: true,
            existing: { draft: existing.draft, filed: existing.filed },
            ...echo,
          });
          return ok({ ...v, notes: [...v.notes, ...inactiveNote(client)] });
        }
        const books = await booksFor(actor, client.id, args.formCode, p.period);
        const data: Record<string, unknown> = {
          ...startingData(args.formCode, p.period),
          ...(books.figures?.figures ?? {}),
        };
        const alphalist =
          args.formCode === "1601EQ"
            ? await alphalists
                .inspect(
                  {
                    status: "draft",
                    period: p.period,
                    dataJson: data,
                    filedSnapshotJson: null,
                  },
                  client,
                )
                .catch(() => null)
            : null;
        const open = await needsFor(
          actor,
          {
            id: null,
            form: args.formCode,
            period: p.period,
            data,
            previewAvailable: false,
          },
          client,
          books,
          alphalist,
        );
        let computed: unknown = null;
        if (books.figures) {
          try {
            computed = birForms.computePreview(args.formCode, data);
          } catch {
            computed = null;
          }
        }
        const { items, other } = computedItems(args.formCode, computed);
        const due = dueDateOf(args.formCode, p.period, fiscalStart(client));
        return ok({
          form: args.formCode,
          formName: typeOf(args.formCode)?.name ?? args.formCode,
          figures: BOOKS_FED.has(args.formCode) ? "books" : "typed",
          client: clientEcho(client),
          ...echo,
          period: p.period,
          exists: false,
          existing: { draft: null, filed: null },
          dueDate: due,
          daysLeft: due ? daysLeft(due, manilaToday()) : null,
          computed: items,
          computedOther: other,
          warnings: open.warnings,
          notes: [...open.notes, ...inactiveNote(client)],
          needs: open.needs,
          prints: printsOf(args.formCode, data, client, null),
        });
      } catch (err) {
        return fail(errMsg(err));
      }
    },
  );

  server.registerTool(
    "portal_create_bir_form_draft",
    {
      title: "Create a BIR form draft",
      description:
        `${BIR_KEY_LINE} Creates the draft for a client, form and period, filled from the client's posted records ` +
        "where the form is books-fed, with optional `data` on top; or, if a draft already exists for that client, form " +
        "and period, answers it with existing:true without creating a second. A period already filed is refused. " +
        "Answers what portal_get_bir_form answers. Never files.",
      inputSchema: {
        ...periodShape,
        data: z
          .record(z.unknown())
          .optional()
          .describe(
            'Draft data keys to set, exact amounts as text, e.g. {"compensation":"100000.00"}',
          ),
      },
      annotations: WRITE_CREATE,
    },
    async (args) => {
      try {
        const actor = await getActor();
        const found = await resolveClient(actor, args);
        if (!found.ok) return ok({ created: false, ...found.answer });
        const client = found.client;
        const p = await resolvePeriod(actor, client, args);
        if ("error" in p) return fail(p.error);
        const echo = { matchedBy: found.matchedBy, periodChoice: p.choice };
        const existing = await birForms.findForPeriod(
          actor,
          client.id,
          args.formCode,
          p.period,
        );
        if (existing.draft) {
          return ok(await view(actor, existing.draft.id, { existing: true, ...echo }));
        }
        if (existing.filed) return fail(sealedMessage(args.formCode));

        const books = await booksFor(actor, client.id, args.formCode, p.period);
        const fed = books.figures?.figures ?? {};
        const given = args.data ?? {};
        const data: Record<string, unknown> = {
          ...startingData(args.formCode, p.period),
          ...fed,
          ...given,
        };
        if (books.figures) {
          data._source = {
            mode: "books",
            asOf: books.figures.asOf,
            fed,
            edited: Object.keys(given).filter((k) => k in fed),
          };
        }
        const created = (await birForms.create(actor, {
          clientId: client.id,
          form: args.formCode,
          period: p.period,
          data,
        })) as unknown as { id: string };
        await recordMcpWrite(actor, "portal_create_bir_form_draft", created.id, {
          clientId: client.id,
          form: args.formCode,
          period: p.period,
          matchedBy: found.matchedBy,
        });
        return ok(await view(actor, created.id, { existing: false, ...echo }));
      } catch (err) {
        return fail(errMsg(err));
      }
    },
  );

  server.registerTool(
    "portal_update_bir_form_draft",
    {
      title: "Update a BIR form draft",
      description:
        `${BIR_KEY_LINE} Sets draft data keys (amounts as text with centavos): the supplied keys replace, the others ` +
        "stay, and null clears a key. Same validation as the web; a filed return is never changed. Answers what " +
        "portal_get_bir_form answers, with the needs still open.",
      inputSchema: {
        id: z
          .string()
          .uuid()
          .describe(
            "BIR form id from portal_create_bir_form_draft or portal_list_bir_forms",
          ),
        data: z.record(z.unknown().nullable()).describe("Keys to set; null clears a key"),
      },
      annotations: WRITE_MUTATE,
    },
    async ({ id, data }) => {
      try {
        const actor = await getActor();
        const current = (await birForms.getOne(actor, id)) as unknown as {
          data: Record<string, unknown>;
        };
        await birForms.update(actor, id, { data: mergeData(current.data ?? {}, data) });
        await recordMcpWrite(actor, "portal_update_bir_form_draft", id, {
          fields: Object.keys(data),
        });
        return ok(await view(actor, id));
      } catch (err) {
        return fail(errMsg(err));
      }
    },
  );

  server.registerTool(
    "portal_get_bir_form",
    {
      title: "Get a BIR form",
      description:
        `${BIR_KEY_LINE} A return as it stands: form, client, period, status, the computed figures with item numbers and ` +
        "labels, warnings, `needs`, the due date and days left, and for a filed return the filed date and the BIR " +
        "confirmation status. Call it again after each answer is written until `needs` is empty.",
      inputSchema: { id: z.string().uuid().describe("BIR form id") },
      annotations: READ_ONLY,
    },
    async ({ id }) => {
      try {
        const actor = await getActor();
        return ok(await view(actor, id));
      } catch (err) {
        return fail(errMsg(err));
      }
    },
  );

  server.registerTool(
    "portal_list_bir_forms",
    {
      title: "List a client's BIR forms",
      description:
        "A client's BIR returns: id, form, period, status and due date. Optional filters: formCode, year, status (draft or filed).",
      inputSchema: {
        ...clientShape,
        formCode: z.string().optional(),
        year: z.number().int().optional(),
        status: z.enum(["draft", "filed"]).optional(),
      },
      annotations: READ_ONLY,
    },
    async ({ client: ref, clientId, formCode, year, status }) => {
      try {
        const actor = await getActor();
        const found = await resolveClient(actor, { client: ref, clientId });
        if (!found.ok) return ok(found.answer);
        const client = found.client;
        const rows = (await birForms.list(actor, client.id, status)) as Array<
          Record<string, any>
        >; // eslint-disable-line @typescript-eslint/no-explicit-any -- the list view
        const forms = rows
          .filter((r) => (formCode ? r.form === formCode : true))
          .filter((r) => (year ? String(r.period).startsWith(String(year)) : true))
          .map((r) => ({
            id: r.id,
            form: r.form,
            period: r.period,
            status: r.status,
            dueDate: dueDateOf(r.form, r.period, fiscalStart(client)),
          }));
        return ok({ client: clientEcho(client), matchedBy: found.matchedBy, forms });
      } catch (err) {
        return fail(errMsg(err));
      }
    },
  );

  server.registerTool(
    "portal_bir_form_preview",
    {
      title: "Preview PDF of a BIR draft",
      description:
        `${BIR_KEY_LINE} A short-lived signed link (1 hour) to the Preview PDF of a draft, stamped DRAFT; or, when the ` +
        "preview would be refused, the Portal's exact refusal sentences and the needs. Never the clear (final) copy: " +
        "that and filing are done in the Portal.",
      inputSchema: { id: z.string().uuid().describe("BIR form id") },
      annotations: READ_ONLY,
    },
    async ({ id }) => {
      try {
        const actor = await getActor();
        try {
          const link = await birForms.previewLink(actor, id);
          return ok({
            ok: true,
            url: link.url,
            filename: link.filename,
            expiresInMinutes: 60,
          });
        } catch (err) {
          if (!(err instanceof ConflictException)) throw err;
          const v = await view(actor, id);
          return ok({
            ok: false,
            refusals: [errMsg(err)],
            ...(errMsg(err) === PREVIEW_FILED
              ? {
                  note: "The connector never makes the clear copy; download it in the Portal.",
                }
              : {}),
            needs: v.needs,
          });
        }
      } catch (err) {
        return fail(errMsg(err));
      }
    },
  );

  server.registerTool(
    "portal_bir_forms_due",
    {
      title: "BIR forms a client must file soon",
      description:
        'Call this when the owner names a client and no form ("draft the forms for client X"). Every return the ' +
        "client must file in the coming 45 days, and any overdue period with no filed return, from the client's " +
        "registered tax types and the filing calendar: form, period, due date, days left or days late, and whether a " +
        "draft or filed return exists (with its id). Offer the list to the owner, then draft with " +
        "portal_bir_form_requirements. Optional asOf date (YYYY-MM-DD), default today.",
      inputSchema: {
        ...clientShape,
        asOf: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
          .optional()
          .describe("Calendar date to count from, default today"),
      },
      annotations: READ_ONLY,
    },
    async ({ client: ref, clientId, asOf }) => {
      try {
        const actor = await getActor();
        const found = await resolveClient(actor, { client: ref, clientId });
        if (!found.ok) return ok(found.answer);
        const client = found.client;
        const today = asOf ?? manilaToday();
        if (new Date(`${today}T00:00:00.000Z`).toISOString().slice(0, 10) !== today) {
          return fail(`asOf ${today} is not a real calendar date.`);
        }
        const rows = (await birForms.list(actor, client.id)) as Array<{
          id: string;
          form: string;
          period: string;
          status: string;
        }>;
        const lookup = (form: string, period: string): ExistingReturns => {
          const mine = rows.filter((r) => r.form === form && r.period === period);
          const draft = mine.find((r) => r.status === "draft");
          const done = mine.find((r) => r.status === "filed");
          return {
            draft: draft ? { id: draft.id } : null,
            filed: done ? { id: done.id } : null,
          };
        };
        const out = dueItems(
          {
            taxType: client.taxType,
            taxTypesJson: client.taxTypesJson,
            fiscalYearStart: fiscalStart(client),
          },
          today,
          lookup,
        );
        return ok({
          client: clientEcho(client),
          matchedBy: found.matchedBy,
          asOf: today,
          forms: formsFor(client),
          items: out.items,
          notes: [...out.notes, ...inactiveNote(client)],
        });
      } catch (err) {
        return fail(errMsg(err));
      }
    },
  );

  server.registerTool(
    "portal_alphalist_check",
    {
      title: "Check a 1601-EQ's alphalist",
      description:
        "The 1601-EQ alphalist (QAP .DAT) check, as the Portal answers it: ok, source, the file name, every refusal, " +
        "the rows and totals of each schedule, and the return's Item 19. Only the 1601-EQ. No file is made.",
      inputSchema: { id: z.string().uuid().describe("BIR form id of a 1601-EQ") },
      annotations: READ_ONLY,
    },
    async ({ id }) => {
      try {
        const actor = await getActor();
        return ok({ ...(await birForms.alphalistCheck(actor, id)) });
      } catch (err) {
        return fail(errMsg(err));
      }
    },
  );

  server.registerTool(
    "portal_alphalist_file",
    {
      title: "Alphalist .DAT link",
      description:
        "A short-lived signed link (1 hour) to the 1601-EQ alphalist .DAT file, when the check is ok; otherwise the " +
        "refusals. The owner still runs the BIR Validation program on the file before eSubmission.",
      inputSchema: { id: z.string().uuid().describe("BIR form id of a 1601-EQ") },
      annotations: READ_ONLY,
    },
    async ({ id }) => {
      try {
        const actor = await getActor();
        const outcome = await birForms.alphalistOutcome(actor, id);
        if (!outcome.check.ok) return ok({ ok: false, refusals: outcome.check.refusals });
        const link = await birForms.alphalistLink(actor, id);
        return ok({
          ok: true,
          url: link.url,
          fileName: link.fileName,
          expiresInMinutes: 60,
        });
      } catch (err) {
        return fail(errMsg(err));
      }
    },
  );

  // `clients` is held for the profile writes the needs point at (portal_update_client).
  void clients;
}
