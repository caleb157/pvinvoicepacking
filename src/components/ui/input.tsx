import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Format a numeric value coming from parent state for display.
 * - Blanks out null/undefined/NaN/Infinity so fields look empty instead of "NaN".
 * - Leaves 0 as "0" so users can type "0.07" without the leading zero disappearing.
 * - Passes through valid strings unchanged so in-progress input like ".", "0.", "-" survives.
 */
function formatNumericForDisplay(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "";
    return String(v);
  }
  if (typeof v === "string") {
    const trimmed = v.trim();
    if (trimmed === "" || trimmed.toLowerCase() === "nan") return "";
    return v;
  }
  return String(v);
}

/**
 * Numeric inputs are tricky to control: the parent typically stores a `number`,
 * but while the user is typing they may pass through transient strings like
 * "", ".", "0.", "-", "0.0" that don't round-trip cleanly through Number().
 *
 * To support typing decimals freely (e.g. ".07", "0.08"), we keep a local
 * "draft" string while the field is focused. The parent's onChange still fires
 * on every keystroke (so calculations stay live whenever the value parses to a
 * finite number), but the displayed text is whatever the user actually typed.
 *
 * On blur we drop the draft and let the parent's value drive display again.
 */
const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, value, defaultValue, inputMode, onChange, onBlur, onFocus, ...props }, ref) => {
    const isNumber = type === "number";
    const renderedType = isNumber ? "text" : type;
    const renderedInputMode = isNumber ? (inputMode ?? "decimal") : inputMode;

    // Local draft text only used for numeric inputs while focused.
    const [draft, setDraft] = React.useState<string | null>(null);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (isNumber) {
        // Allow only characters that can appear in a decimal number.
        // Permits leading "-", a single ".", and digits. Reject anything else
        // so stray letters don't sneak in via paste/IME.
        const raw = e.target.value;
        const cleaned = raw.replace(/[^0-9.\-]/g, "");
        // Collapse multiple dots / stray minus signs to keep things sane,
        // but preserve in-progress states like "-", ".", "0.".
        let normalized = cleaned;
        // Only one leading minus
        normalized = normalized.replace(/(?!^)-/g, "");
        // Only one decimal point
        const firstDot = normalized.indexOf(".");
        if (firstDot !== -1) {
          normalized =
            normalized.slice(0, firstDot + 1) +
            normalized.slice(firstDot + 1).replace(/\./g, "");
        }
        setDraft(normalized);
        if (normalized !== raw) {
          // Mutate the event so downstream handlers see the cleaned value.
          e.target.value = normalized;
        }
      }
      onChange?.(e);
    };

    const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
      if (isNumber) setDraft(null);
      onBlur?.(e);
    };

    const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
      if (isNumber) {
        // Seed the draft from current displayed value so the first keystroke
        // doesn't wipe it.
        setDraft(formatNumericForDisplay(value));
      }
      onFocus?.(e);
    };

    const renderedValue =
      isNumber && value !== undefined
        ? draft !== null
          ? draft
          : formatNumericForDisplay(value)
        : value;
    const renderedDefault =
      isNumber && defaultValue !== undefined
        ? formatNumericForDisplay(defaultValue)
        : defaultValue;

    return (
      <input
        type={renderedType}
        inputMode={renderedInputMode}
        className={cn(
          "flex h-9 w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm leading-tight ring-offset-background transition-[border-color,box-shadow] file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground hover:border-ring/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        ref={ref}
        onChange={handleChange}
        onBlur={handleBlur}
        onFocus={handleFocus}
        {...(renderedValue !== undefined ? { value: renderedValue as any } : {})}
        {...(renderedDefault !== undefined ? { defaultValue: renderedDefault as any } : {})}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
