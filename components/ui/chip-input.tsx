"use client";

import { X } from "lucide-react";
import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type ChipInputProps = {
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  className?: string;
};

export function ChipInput({
  value,
  onChange,
  placeholder,
  className,
}: ChipInputProps) {
  const [draft, setDraft] = React.useState("");

  function addChip(rawValue: string) {
    const nextValue = rawValue.trim();

    if (!nextValue || value.includes(nextValue)) {
      return;
    }

    onChange([...value, nextValue]);
    setDraft("");
  }

  function removeChip(chip: string) {
    onChange(value.filter((item) => item !== chip));
  }

  return (
    <div
      className={cn(
        "flex min-h-10 w-full flex-wrap items-center gap-2 rounded-md border border-input px-2 py-2 shadow-sm focus-within:ring-1 focus-within:ring-ring",
        className,
      )}
    >
      {value.map((chip) => (
        <Badge
          className="gap-1 rounded-md px-2 py-1"
          key={chip}
          variant="secondary"
        >
          {chip}
          <button
            aria-label={`Remove ${chip}`}
            className="rounded-sm text-muted-foreground transition-colors hover:text-foreground"
            onClick={() => removeChip(chip)}
            type="button"
          >
            <X className="size-3" />
          </button>
        </Badge>
      ))}
      <Input
        className="h-7 min-w-36 flex-1 border-0 px-1 shadow-none focus-visible:ring-0"
        onBlur={() => addChip(draft)}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === ",") {
            event.preventDefault();
            addChip(draft);
          }

          if (event.key === "Backspace" && !draft && value.length > 0) {
            removeChip(value[value.length - 1]);
          }
        }}
        placeholder={placeholder}
        value={draft}
      />
    </div>
  );
}
