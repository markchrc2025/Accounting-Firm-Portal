// AtcGateHint — Track A U27 / W27 (D74): why Export eBIRForms XML, Mark as filed or Download
// clear copy is held back while a required ATC is empty. The sentences are @portal/shared's
// missingAtcs, the same the API answers with its 409; nothing here picks an ATC.

export function AtcGateHint({ sentences }: { sentences: readonly string[] }) {
  if (sentences.length === 0) return null;
  return (
    <p data-atc-gate role="note" className="text-center text-[11.5px] text-content-muted">
      {sentences.join(" ")}
    </p>
  );
}
