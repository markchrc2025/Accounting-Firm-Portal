import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import {
  CLIENT_DELETE_BLOCKER_KINDS,
  CLIENT_DELETE_KINDS,
  type ClientDeleteBlockerKind,
  type ClientDeleteKind,
  type ClientUnlinkKind,
} from "@portal/shared";
import type { AuthUser } from "../common/auth/auth-user";
import { PrismaService } from "../prisma/prisma.service";
import { CLIENTS_DELETE } from "../rbac/permissions.constants";
import { RbacService } from "../rbac/rbac.service";
import { StorageService } from "../storage/storage.service";
import {
  CLIENT_NOT_FOUND,
  NAME_MISMATCH,
  foldName,
  nameToType,
  refusalSentence,
} from "./client-delete";

type Db = PrismaService | Prisma.TransactionClient;
type Counted<K extends string> = { kind: K; count: number };
type ClientRow = NonNullable<Awaited<ReturnType<PrismaService["client"]["findFirst"]>>>;

export interface DeleteCheck {
  canDelete: boolean;
  /** The name the owner must type (confirmName). */
  nameToType: string;
  blockers: (Counted<ClientDeleteBlockerKind> & { sentence: string })[];
  willDelete: Counted<ClientDeleteKind>[];
  willUnlink: Counted<ClientUnlinkKind>[];
}

export interface DeleteResult {
  deleted: Counted<ClientDeleteKind>[];
  unlinked: Counted<ClientUnlinkKind>[];
  /** Stored files the object store would not remove; logged. The delete stands. */
  filesNotRemoved: { key: string }[];
}

/** Only the kinds with something in them, in the shared list's order. */
function listed<K extends string>(
  order: readonly K[],
  counts: Partial<Record<K, number>>,
) {
  return order
    .map((kind) => ({ kind, count: counts[kind] ?? 0 }))
    .filter((c) => c.count > 0);
}

/**
 * U25 (D72): delete a client permanently with everything that belongs only to it, or refuse
 * in one sentence when it holds a sealed or shared record (a filed return, a sent invoice, an
 * invoice of another client billed for it, a linked project, a sub-client). One transaction;
 * the stored files go after the commit.
 */
@Injectable()
export class ClientDeleteService {
  private readonly logger = new Logger(ClientDeleteService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly rbac: RbacService,
    private readonly storage: StorageService,
  ) {}

  /** The client in the caller's firm (404 otherwise), and the caller may delete it. */
  private async find(user: AuthUser, clientId: string): Promise<ClientRow> {
    const client = await this.prisma.client.findFirst({
      where: { id: clientId, firmId: user.firmId },
    });
    if (!client) throw new NotFoundException(CLIENT_NOT_FOUND);
    await this.rbac.assertClient(user, [CLIENTS_DELETE], clientId);
    return client;
  }

  /** What blocks, what would go and what would be unlinked, counted from `db`. */
  private async survey(db: Db, client: ClientRow) {
    const clientId = client.id;
    const [filedForms, filedFilings, sent, billedFor, projects, subClients] =
      await Promise.all([
        db.birForm.count({
          where: {
            clientId,
            OR: [
              { status: { not: "draft" } },
              { filingUndos: { some: {} } },
              { confirmations: { some: {} } },
            ],
          },
        }),
        db.bIRFiling.count({ where: { clientId, status: "filed" } }),
        db.invoice.count({ where: { clientId, status: { not: "Draft" } } }),
        db.invoice.count({
          where: { billedForClientId: clientId, clientId: { not: clientId } },
        }),
        db.project.count({ where: { clientId } }),
        db.client.count({ where: { billingParentId: clientId, id: { not: clientId } } }),
      ]);
    const blocking: Record<ClientDeleteBlockerKind, number> = {
      filedBirReturns: filedForms + filedFilings,
      sentInvoices: sent,
      billedForInvoices: billedFor,
      linkedProjects: projects,
      subClients,
    };
    const blockers = listed(CLIENT_DELETE_BLOCKER_KINDS, blocking).map((b) => ({
      ...b,
      sentence: refusalSentence([b]),
    }));

    const going: Record<ClientDeleteKind, number> = {
      incomeTransactions: await db.incomeTransaction.count({ where: { clientId } }),
      purchaseTransactions: await db.purchaseTransaction.count({ where: { clientId } }),
      categories: await db.category.count({ where: { clientId } }),
      birFormDrafts: await db.birForm.count({ where: { clientId, status: "draft" } }),
      birFormDraftFiles: await db.birFormExport.count({
        where: { birForm: { clientId, status: "draft" } },
      }),
      birFilingsNotFiled: await db.bIRFiling.count({
        where: { clientId, status: { not: "filed" } },
      }),
      receiptScans: await db.receiptScan.count({ where: { clientId } }),
      receiptScanFiles: await db.receiptScanFile.count({ where: { scan: { clientId } } }),
      inputTaxAssets: await db.inputTaxAsset.count({ where: { clientId } }),
      taxRules: await db.taxRule.count({ where: { clientId } }),
      draftInvoices: await db.invoice.count({ where: { clientId, status: "Draft" } }),
      corFiles: client.corPath ? 1 : 0,
      clientUserProfiles: await db.clientUserProfile.count({ where: { clientId } }),
      invitations: await db.invitation.count({ where: { clientId } }),
      clientRoleGrants: await db.userRole.count({ where: { clientScopeId: clientId } }),
      staffAssignments: await db.firmClientAssignment.count({ where: { clientId } }),
    };
    const unlinking: Record<ClientUnlinkKind, number> = {
      fsReports: await db.fsReport.count({ where: { firmId: client.firmId, clientId } }),
    };
    return {
      blockers,
      willDelete: listed(CLIENT_DELETE_KINDS, going),
      willUnlink: listed(["fsReports"] as const, unlinking),
    };
  }

  /** GET /clients/:clientId/delete-check. */
  async check(user: AuthUser, clientId: string): Promise<DeleteCheck> {
    const client = await this.find(user, clientId);
    const s = await this.survey(this.prisma, client);
    return {
      canDelete: s.blockers.length === 0,
      nameToType: nameToType(client),
      blockers: s.blockers,
      willDelete: s.willDelete,
      willUnlink: s.willUnlink,
    };
  }

  /** DELETE /clients/:clientId with { confirmName }. */
  async delete(
    user: AuthUser,
    clientId: string,
    confirmName: unknown,
  ): Promise<DeleteResult> {
    const client = await this.find(user, clientId);
    const typed = foldName(confirmName);
    if (typed === "" || typed !== foldName(nameToType(client))) {
      throw new BadRequestException(NAME_MISMATCH);
    }

    const { deleted, unlinked, keys } = await this.prisma.$transaction(
      async (tx) => {
        // Hold the client and the rows that can block, so nothing is filed, sent or linked
        // between the count and the delete (a new child row waits on the client's lock).
        await tx.$queryRaw`SELECT 1 FROM "clients" WHERE "id" = ${clientId}::uuid FOR UPDATE`;
        await tx.$queryRaw`SELECT 1 FROM "bir_forms" WHERE "clientId" = ${clientId}::uuid FOR UPDATE`;
        await tx.$queryRaw`SELECT 1 FROM "bir_filings" WHERE "clientId" = ${clientId}::uuid FOR UPDATE`;
        await tx.$queryRaw`SELECT 1 FROM "invoices" WHERE "clientId" = ${clientId}::uuid OR "billedForClientId" = ${clientId}::uuid FOR UPDATE`;
        const fresh = await tx.client.findUniqueOrThrow({ where: { id: clientId } });
        const s = await this.survey(tx, fresh);
        if (s.blockers.length > 0)
          throw new ConflictException(refusalSentence(s.blockers));

        // The stored files, read before their rows go: the COR, then the drafts' files, then
        // the receipt photos.
        const exportsOf = await tx.birFormExport.findMany({
          where: { birForm: { clientId } },
          select: { storageKey: true },
          orderBy: { createdAt: "asc" },
        });
        const photos = await tx.receiptScanFile.findMany({
          where: { scan: { clientId }, storageKey: { not: null } },
          select: { storageKey: true },
          orderBy: [{ createdAt: "asc" }, { position: "asc" }],
        });
        const fileKeys = [
          ...(fresh.corPath ? [fresh.corPath] : []),
          ...exportsOf.map((e) => e.storageKey),
          ...photos.map((p) => p.storageKey as string),
        ];

        const where = { clientId };
        const n: Record<ClientDeleteKind, number> = {
          incomeTransactions: (await tx.incomeTransaction.deleteMany({ where })).count,
          purchaseTransactions: (await tx.purchaseTransaction.deleteMany({ where }))
            .count,
          categories: (await tx.category.deleteMany({ where })).count,
          birFormDraftFiles: (
            await tx.birFormExport.deleteMany({ where: { birForm: { clientId } } })
          ).count,
          birFormDrafts: (await tx.birForm.deleteMany({ where })).count,
          birFilingsNotFiled: (await tx.bIRFiling.deleteMany({ where })).count,
          receiptScanFiles: 0,
          receiptScans: 0,
          inputTaxAssets: (await tx.inputTaxAsset.deleteMany({ where })).count,
          taxRules: (await tx.taxRule.deleteMany({ where })).count,
          draftInvoices: (await tx.invoice.deleteMany({ where })).count,
          corFiles: fresh.corPath ? 1 : 0,
          clientUserProfiles: (await tx.clientUserProfile.deleteMany({ where })).count,
          invitations: (await tx.invitation.deleteMany({ where })).count,
          clientRoleGrants: (
            await tx.userRole.deleteMany({ where: { clientScopeId: clientId } })
          ).count,
          staffAssignments: (await tx.firmClientAssignment.deleteMany({ where })).count,
        };
        await tx.receiptScanRow.deleteMany({ where: { scan: { clientId } } });
        n.receiptScanFiles = (
          await tx.receiptScanFile.deleteMany({ where: { scan: { clientId } } })
        ).count;
        n.receiptScans = (await tx.receiptScan.deleteMany({ where })).count;
        const u: Record<ClientUnlinkKind, number> = {
          fsReports: (
            await tx.fsReport.updateMany({
              where: { firmId: fresh.firmId, clientId },
              data: { clientId: null },
            })
          ).count,
        };
        await tx.client.delete({ where: { id: clientId } });

        const deletedList = listed(CLIENT_DELETE_KINDS, n);
        const unlinkedList = listed(["fsReports"] as const, u);
        // The audit row is written in the same transaction: no delete without its record.
        await tx.auditLog.create({
          data: {
            userId: user.id,
            action: "client.deleted",
            entityType: "Client",
            entityId: clientId,
            metadata: {
              registeredName: nameToType(fresh),
              tin: fresh.tin,
              deleted: Object.fromEntries(deletedList.map((d) => [d.kind, d.count])),
              unlinked: Object.fromEntries(unlinkedList.map((d) => [d.kind, d.count])),
            },
          },
        });
        return { deleted: deletedList, unlinked: unlinkedList, keys: fileKeys };
      },
      { timeout: 60_000 },
    );

    const filesNotRemoved: { key: string }[] = [];
    for (const key of keys) {
      try {
        await this.storage.deleteObject(key);
      } catch (err) {
        this.logger.warn(
          `Client ${clientId} was deleted but its stored file ${key} could not be removed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        filesNotRemoved.push({ key });
      }
    }
    return { deleted, unlinked, filesNotRemoved };
  }
}
