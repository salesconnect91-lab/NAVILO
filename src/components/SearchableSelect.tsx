import { Children, isValidElement, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import type { ChangeEvent, ReactElement, ReactNode, SelectHTMLAttributes } from "react";

type Props = Omit<SelectHTMLAttributes<HTMLSelectElement>, "children"> & {
  children: ReactNode;
  searchPlaceholder?: string;
  emptyText?: string;
};

type Option = { value: string; label: string; searchText: string; disabled: boolean };

function textOf(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement(node)) return textOf((node.props as { children?: ReactNode }).children);
  return "";
}

function looksLikeBusinessCode(value: string): boolean {
  const code = value.trim();
  if (!code || /[\u0600-\u06FF\s]/.test(code)) return false;
  return /\d/.test(code) || /^[A-Z]{2,}(?:[-_/][A-Z0-9._/#-]+)*$/.test(code);
}

/**
 * NAVILO display rule: business/master codes stay internal/searchable but are not
 * shown beside human-readable names in dropdowns. Examples:
 *   FG-001 — Girder            -> Girder
 *   1100 - Cash in Hand        -> Cash in Hand
 *   SUP-004 | Al Noor Traders  -> Al Noor Traders
 *   Girder (FG-001)            -> Girder
 *   Girder · FG-001            -> Girder
 * Bilingual labels such as "Customer / گاہک" are left untouched.
 */
function displayLabel(raw: string): string {
  const value = raw.replace(/\s+/g, " ").trim();
  const leadingCode = value.match(/^([A-Za-z0-9][A-Za-z0-9._/#()]*?(?:-[A-Za-z0-9._/#()]+)*)\s+(?:—|–|-|·|\||:)\s+(.+)$/);
  if (leadingCode) {
    const prefix = leadingCode[1];
    const name = leadingCode[2].trim();
    if (looksLikeBusinessCode(prefix) && name) return name;
  }

  const trailingParenthesizedCode = value.match(/^(.+?)\s+\(([A-Za-z0-9._/#-]+)\)$/);
  if (trailingParenthesizedCode) {
    const name = trailingParenthesizedCode[1].trim();
    const code = trailingParenthesizedCode[2].trim();
    if (looksLikeBusinessCode(code) && name) return name;
  }

  const trailingSeparatedCode = value.match(/^(.+?)\s+(?:—|–|·|\||:)\s+([A-Za-z0-9._/#-]+)$/);
  if (trailingSeparatedCode) {
    const name = trailingSeparatedCode[1].trim();
    const code = trailingSeparatedCode[2].trim();
    if (looksLikeBusinessCode(code) && name) return name;
  }

  return value;
}

function collectOptions(children: ReactNode): Option[] {
  const result: Option[] = [];
  Children.forEach(children, child => {
    if (!isValidElement(child)) return;
    const element = child as ReactElement<{ value?: string | number; disabled?: boolean; children?: ReactNode }>;
    if (element.type === "option") {
      const rawLabel = textOf(element.props.children).trim() || String(element.props.value ?? "");
      result.push({
        value: String(element.props.value ?? ""),
        label: displayLabel(rawLabel),
        searchText: rawLabel,
        disabled: Boolean(element.props.disabled),
      });
      return;
    }
    if (element.type === "optgroup") result.push(...collectOptions(element.props.children));
  });
  return result;
}

export default function SearchableSelect({
  children,
  className = "",
  value,
  defaultValue,
  onChange,
  disabled,
  name,
  id,
  searchPlaceholder = "Type to search...",
  emptyText = "No matching option",
  ...props
}: Props) {
  const options = useMemo(() => collectOptions(children), [children]);
  const controlled = value !== undefined;
  const [internalValue, setInternalValue] = useState(String(defaultValue ?? ""));
  const selectedValue = controlled ? String(value ?? "") : internalValue;
  const selected = options.find(option => option.value === selectedValue) ?? null;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    return options.filter(option => !q || `${option.label} ${option.searchText}`.toLocaleLowerCase().includes(q));
  }, [options, query]);

  const commit = (nextValue: string) => {
    const option = options.find(candidate => candidate.value === nextValue);
    if (!option || option.disabled || disabled) return;
    if (!controlled) setInternalValue(nextValue);
    if (onChange) {
      const target = { value: nextValue, name: name ?? "" } as HTMLSelectElement;
      onChange({ target, currentTarget: target } as ChangeEvent<HTMLSelectElement>);
    }
    setOpen(false);
    setQuery("");
  };

  return (
    <div ref={rootRef} className="relative w-full min-w-0">
      <button
        id={id}
        type="button"
        disabled={disabled}
        className={`${className} flex w-full items-center justify-between gap-2 text-left`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={props["aria-label"]}
        title={props.title}
        onClick={() => {
          if (disabled) return;
          setOpen(current => !current);
          setQuery("");
          requestAnimationFrame(() => inputRef.current?.focus());
        }}
      >
        <span className={`min-w-0 flex-1 truncate ${selectedValue ? "text-slate-900" : "text-slate-500"}`}>
          {selected?.label || "Select..."}
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-[90] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl">
          <div className="border-b border-slate-100 p-2">
            <div className="flex h-9 items-center gap-2 rounded-md border border-slate-300 bg-white px-2 focus-within:border-primary-500 focus-within:ring-1 focus-within:ring-primary-500">
              <Search className="h-4 w-4 shrink-0 text-slate-400" />
              <input
                ref={inputRef}
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder={searchPlaceholder}
                className="min-w-0 flex-1 border-0 bg-transparent text-sm outline-none placeholder:text-slate-400"
                autoComplete="off"
              />
            </div>
          </div>
          <div role="listbox" className="max-h-60 overflow-auto p-1">
            {filtered.length ? filtered.map(option => (
              <button
                key={`${option.value}-${option.searchText}`}
                type="button"
                role="option"
                aria-selected={option.value === selectedValue}
                disabled={option.disabled}
                onMouseDown={event => event.preventDefault()}
                onClick={() => commit(option.value)}
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-slate-700 hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <span className="min-w-0 flex-1 break-words">{option.label || "—"}</span>
                {option.value === selectedValue && <Check className="h-4 w-4 shrink-0 text-blue-600" />}
              </button>
            )) : (
              <div className="px-3 py-4 text-center text-sm text-slate-500">{emptyText}</div>
            )}
          </div>
        </div>
      )}
      {name ? <input type="hidden" name={name} value={selectedValue} /> : null}
    </div>
  );
}
