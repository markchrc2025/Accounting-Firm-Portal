// CopyButton - a Copy button that says it worked (PB3). Nothing is shown of what was copied.

import { useEffect, useState } from "react";
import { Button } from "../ui";
import { copyText } from "../../lib/clipboard";

export function CopyButton({
  text,
  label = "Copy",
  what,
}: {
  text: string;
  label?: string;
  /** What is being copied, for a screen reader: "Copy the token". */
  what?: string;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (state === "idle") return;
    const t = window.setTimeout(() => setState("idle"), 2500);
    return () => window.clearTimeout(t);
  }, [state]);
  return (
    <span className="inline-flex items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label={what ?? label}
        onClick={async () => setState((await copyText(text)) ? "copied" : "failed")}
      >
        {state === "copied" ? "Copied" : label}
      </Button>
      <span role="status" className="text-[12px] text-content-secondary">
        {state === "copied" ? "Copied to the clipboard." : ""}
        {state === "failed" ? "Could not copy. Select the text and copy it yourself." : ""}
      </span>
    </span>
  );
}
