/**
 * BillingDocument — the printable/exportable firm billing statement. Rendered
 * off-screen at A4 proportions (794px ≈ 210mm @96dpi) and captured by
 * html2canvas for the PDF / JPEG exports, so everything here must be plain
 * DOM + Tailwind v3 utilities (hex/rgb colors only — no external images).
 *
 * GUARDRAIL-neutral: this is the FIRM's billing statement for its services —
 * explicitly NOT an official BIR receipt/invoice, and the footer says so.
 */
import { McrcMark } from "./McrcMark";
import { peso } from "./ui";
import type { Invoice } from "../lib/api";

export function BillingDocument({ invoice }: { invoice: Invoice }) {
  return (
    <div
      className="flex min-h-[1123px] w-[794px] flex-col bg-white font-sans text-[#1c2b3a]"
      data-billing-document
    >
      {/* Header band */}
      <div className="flex items-center justify-between bg-navy px-12 py-8">
        <div className="flex items-center gap-4">
          <McrcMark variant="navy" size={44} />
          <div className="leading-tight">
            <div className="font-serif text-[22px] font-medium text-white">
              MCRC Tax &amp; Accounting
            </div>
            <div className="font-mono text-[10px] uppercase tracking-[.2em] text-gold-soft">
              Accounting &amp; Advisory
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="font-serif text-[24px] font-medium text-white">BILLING</div>
          <div className="font-mono text-[13px] text-gold-soft">{invoice.number}</div>
        </div>
      </div>

      {/* Meta + bill-to */}
      <div className="flex items-start justify-between px-12 pb-2 pt-10">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[.18em] text-[#8a94a3]">
            Billed to
          </div>
          <div className="mt-1 font-serif text-[19px] font-medium text-navy">
            {invoice.clientName || "—"}
          </div>
          {invoice.billedForName ? (
            <div className="mt-0.5 font-mono text-[11px] uppercase tracking-[.08em] text-[#8a94a3]">
              For: {invoice.billedForName}
            </div>
          ) : null}
          {invoice.description ? (
            <div className="mt-2 text-[13px] text-[#5a6572]">{invoice.description}</div>
          ) : null}
        </div>
        <table className="text-[13px]">
          <tbody>
            <tr>
              <td className="pr-6 font-mono text-[10px] uppercase tracking-[.14em] text-[#8a94a3]">
                Control No.
              </td>
              <td className="text-right font-mono font-semibold text-navy">{invoice.number}</td>
            </tr>
            <tr>
              <td className="pr-6 pt-1.5 font-mono text-[10px] uppercase tracking-[.14em] text-[#8a94a3]">
                Billing date
              </td>
              <td className="pt-1.5 text-right font-mono">{invoice.issuedDate}</td>
            </tr>
            <tr>
              <td className="pr-6 pt-1.5 font-mono text-[10px] uppercase tracking-[.14em] text-[#8a94a3]">
                Due date
              </td>
              <td className="pt-1.5 text-right font-mono">{invoice.dueDate}</td>
            </tr>
            <tr>
              <td className="pr-6 pt-1.5 font-mono text-[10px] uppercase tracking-[.14em] text-[#8a94a3]">
                Status
              </td>
              <td className="pt-1.5 text-right font-semibold">{invoice.status}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Line items */}
      <div className="px-12 pt-8">
        <table className="w-full border-collapse text-left text-[13px]">
          <thead>
            <tr className="border-b-2 border-navy font-mono text-[10px] uppercase tracking-[.14em] text-[#5a6572]">
              <th className="py-2.5 font-semibold">Description</th>
              <th className="w-20 py-2.5 text-right font-semibold">Qty</th>
              <th className="w-32 py-2.5 text-right font-semibold">Rate</th>
              <th className="w-36 py-2.5 text-right font-semibold">Amount</th>
            </tr>
          </thead>
          <tbody>
            {invoice.lineItems.map((li, i) => (
              <tr key={i} className="border-b border-[#e4e0d6]">
                <td className="py-3">{li.description || "—"}</td>
                <td className="py-3 text-right font-mono tabular-nums">{Number(li.qty)}</td>
                <td className="py-3 text-right font-mono tabular-nums">{peso(li.rate)}</td>
                <td className="py-3 text-right font-mono tabular-nums">{peso(li.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totals */}
        <div className="mt-6 flex justify-end">
          <table className="w-64 text-[13px]">
            <tbody>
              <tr>
                <td className="py-1 text-[#5a6572]">Subtotal</td>
                <td className="py-1 text-right font-mono tabular-nums">{peso(invoice.subtotal)}</td>
              </tr>
              <tr>
                <td className="py-1 text-[#5a6572]">VAT 12%</td>
                <td className="py-1 text-right font-mono tabular-nums">{peso(invoice.vat)}</td>
              </tr>
              <tr className="border-t-2 border-navy">
                <td className="py-2 font-serif text-[16px] font-medium text-navy">Total due</td>
                <td className="py-2 text-right font-mono text-[16px] font-semibold tabular-nums text-navy">
                  {peso(invoice.total)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Footer */}
      <div className="mt-auto px-12 pb-10">
        <div className="border-t border-[#e4e0d6] pt-4 text-center">
          <p className="text-[11px] text-[#8a94a3]">
            Prepared by MCRC Tax &amp; Accounting. This billing statement covers professional
            services rendered and is not an official BIR receipt or invoice.
          </p>
        </div>
      </div>
    </div>
  );
}
