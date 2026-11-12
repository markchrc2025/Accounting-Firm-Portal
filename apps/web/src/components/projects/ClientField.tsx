// ClientField - the project's client, typed and searched (PB7, PA8 / D70). Suggestions come from the
// firm's client list as the person types; picking one sets the client. A name that is not on the
// list is kept as typed, with the note "Not in your client list". Nothing is linked by itself.

import { useId, useState, type KeyboardEvent } from "react";
import { cn } from "../ui";
import { clientSuggestions, isListedName, NOT_LISTED_NOTE } from "../../lib/projects";

interface Listed {
  id: string;
  businessName: string;
}

export function ClientField<T extends Listed>({
  clients,
  name,
  clientId,
  onType,
  onPick,
}: {
  clients: T[];
  name: string;
  clientId: string | null;
  onType: (text: string) => void;
  onPick: (client: T) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const list = open ? clientSuggestions(clients, name) : [];
  const notListed = !clientId && name.trim() !== "" && !isListedName(clients, name);

  function pick(c: T) {
    onPick(c);
    setOpen(false);
  }
  function keys(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(a + 1, Math.max(list.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter" && open && list[active]) {
      e.preventDefault();
      pick(list[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="relative" data-client-field>
      <label
        htmlFor={`${id}-input`}
        className="mb-1.5 block text-[13px] font-semibold text-content"
      >
        Client
      </label>
      <input
        id={`${id}-input`}
        className="input"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={list.length > 0}
        aria-controls={`${id}-list`}
        aria-describedby={`${id}-hint`}
        autoComplete="off"
        value={name}
        placeholder="Type a client's name"
        onChange={(e) => {
          onType(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={keys}
      />
      {list.length > 0 ? (
        <ul
          id={`${id}-list`}
          role="listbox"
          aria-label="Clients"
          className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-input border border-line-input bg-card py-1 shadow-lg"
        >
          {list.map((c, i) => (
            <li
              key={c.id}
              role="option"
              aria-selected={i === active}
              data-client-option={c.id}
              // mousedown, so the pick lands before the box loses focus and closes the list
              onMouseDown={(e) => {
                e.preventDefault();
                pick(c);
              }}
              className={cn(
                "cursor-pointer px-3 py-1.5 text-[13px]",
                i === active ? "bg-rowhover text-navy" : "text-content",
              )}
            >
              {c.businessName}
            </li>
          ))}
        </ul>
      ) : null}
      <span id={`${id}-hint`} className="mt-1 block text-[11.5px] text-content-secondary">
        {notListed ? (
          <span data-client-not-listed className="font-semibold text-warn">
            {NOT_LISTED_NOTE}
          </span>
        ) : (
          "Optional. Pick a listed client, or type any name."
        )}
      </span>
    </div>
  );
}
