/**
 * file-return.ts — U18: since a return is marked filed with the BIR's confirmation, the
 * db specs that need a FILED return as a starting point go through the real thing:
 * build a matching confirmation PDF (invented values, pdf-lib) and POST mark-filed.
 * Each call gets its own received minute, so no two returns share a confirmation.
 */
import type { INestApplication } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import request from "supertest";
import { PrismaService } from "../../src/prisma/prisma.service";
import { periodEndFor } from "../../src/bir-confirmation/return-timing";
import { confirmationPdf } from "./confirmation-pdf";

/** In-memory object storage standing in for S3 (the one every spec that files uses). */
export class FakeStorage {
  objects = new Map<string, { body: Uint8Array; contentType: string }>();
  isEnabled() {
    return true;
  }
  birFormExportKey(firmId: string, birFormId: string, filename: string) {
    return `bir-forms/${firmId}/${birFormId}/${filename}`;
  }
  async putObject(key: string, body: Uint8Array, contentType: string) {
    this.objects.set(key, { body, contentType });
  }
  async deleteObject(key: string) {
    this.objects.delete(key);
  }
  async signedGetUrl(key: string, opts?: { filename?: string }) {
    return `https://storage.test/${key}?signed=1&name=${encodeURIComponent(opts?.filename ?? "")}`;
  }
}

let minute = 0;

const p2 = (n: number) => String(n).padStart(2, "0");
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** The BIR file name for a return, in the shapes the unit documents (verified or derived). */
export function birFileNameFor(r: {
  form: string;
  period: string;
  tin: string;
  branch: string;
  fyEndMonth?: number;
  amendment?: number;
}): string {
  const tin = r.tin.replace(/\D/g, "").slice(0, 9);
  const b = r.branch.replace(/\D/g, "") || "0";
  const b3 = b.padStart(3, "0").slice(-3);
  const b5 = b.padStart(5, "0").slice(-5);
  const year = r.period.slice(0, 4);
  const q = /Q([1-4])$/i.exec(r.period)?.[1] ?? "1";
  const mm = p2(r.fyEndMonth ?? 12);
  const month = r.period.slice(5, 7);
  const v = r.amendment ? `V${r.amendment}` : "";
  const names: Record<string, string> = {
    "2550Q": `${tin}${b3}-2550Qv2024-${mm}${year}Q${q}${v}.xml`,
    "2551Q": `${tin}${b3}2551Qv201812${year}Q${q}${v}.xml`,
    "1701Q": `${tin}${b3}-1701Qv2018-${year}Q${q}${v}.xml`,
    "1701": `${tin}${b3}1701v201812${year}${v}.xml`,
    "1701A": `${tin}${b3}1701A12${year}${v}.xml`,
    "1702Q": `${tin}${b3}1702Q${year}Q${q}${v}.xml`,
    "1702RT": `${tin}${b3}1702RTv201812${year}${v}.xml`,
    "0619E": `${tin}${b5}-0619E-${month}${year}${v}.xml`,
    "1601EQ": `${tin}${b5}-1601EQ-${year}Q${q}${v}.xml`,
  };
  const name = names[r.form];
  if (!name) throw new Error(`no confirmation file name for ${r.form}`);
  return name;
}

/** A confirmation PDF that passes every check for this stored return. */
export async function confirmationFor(db: PrismaClient, birFormId: string): Promise<Buffer> {
  const f = await db.birForm.findUniqueOrThrow({
    where: { id: birFormId },
    include: { client: true },
  });
  const start = f.client.fiscalYearStart ? f.client.fiscalYearStart.toISOString().slice(0, 10) : null;
  const sm = start ? Number(start.slice(5, 7)) : 1;
  const end = periodEndFor(f.form, f.period, sm >= 2 ? start : null);
  // The day after the period, but never in the future (and never before the year 2000).
  const wantMs = Date.parse(`${end ?? "2026-01-01"}T00:00:00Z`) + 86_400_000;
  const latest = Date.now() - 2 * 86_400_000;
  const when = new Date(Math.min(wantMs, latest));
  const n = minute++;
  const hour24 = Math.floor(n / 60) % 24;
  const time = `${p2(hour24 % 12 === 0 ? 12 : hour24 % 12)}:${p2(n % 60)} ${hour24 < 12 ? "AM" : "PM"}`;
  return confirmationPdf({
    fileName: birFileNameFor({
      form: f.form,
      period: f.period,
      tin: f.client.tin ?? "",
      branch: f.client.branch,
      fyEndMonth: sm >= 2 ? sm - 1 : 12,
      amendment: f.sequence > 1 ? f.sequence - 1 : undefined,
    }),
    date: `${when.getUTCDate()} ${MONTHS[when.getUTCMonth()]} ${when.getUTCFullYear()}`,
    time,
  });
}

/** Mark a draft filed through the real contract; returns the response (callers assert it). */
export async function fileWithConfirmation(
  app: INestApplication,
  token: string,
  birFormId: string,
): Promise<request.Response> {
  const bytes = await confirmationFor(app.get(PrismaService), birFormId);
  return request(app.getHttpServer())
    .post(`/api/v1/bir-forms/${birFormId}/mark-filed`)
    .set("Authorization", `Bearer ${token}`)
    .attach("file", bytes, { filename: "confirmation.pdf", contentType: "application/pdf" });
}

/**
 * Mark a draft filed the way the Portal does for its form: the nine returns with a BIR
 * confirmation through mark-filed, the 1601-C / 2307 / 2316 through PATCH as before.
 */
export async function markFiledAny(
  app: INestApplication,
  token: string,
  birFormId: string,
): Promise<request.Response> {
  const f = await app.get(PrismaService).birForm.findUniqueOrThrow({ where: { id: birFormId } });
  if (["1601C", "2307", "2316"].includes(f.form)) {
    return request(app.getHttpServer())
      .patch(`/api/v1/bir-forms/${birFormId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "filed" });
  }
  return fileWithConfirmation(app, token, birFormId);
}
