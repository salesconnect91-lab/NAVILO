import { Fragment, Children, isValidElement, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search } from "lucide-react";
import type { ChangeEvent, ReactElement, ReactNode, SelectHTMLAttributes } from "react";

type Props = Omit<SelectHTMLAttributes<HTMLSelectElement>, "children"> & {
  children: ReactNode;
  wrapperClassName?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  preserveLabel?: boolean;
  nativeCompatibility?: boolean;
};

type Option = { value: string; label: string; searchText: string; disabled: boolean };
type DropdownPosition = { left: number; top: number; width: number };

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

function displayLabel(raw: string): string {
  const value = raw.replace(/\s+/g, " ").trim();
  const separatedParts = value.split(/\s+(?:—|–|·|\|)\s+/).map(part => part.trim()).filter(Boolean);
  if (separatedParts.length > 1) {
    if (looksLikeBusinessCode(separatedParts[0])) return separatedParts.slice(1).join(" — ");
    if (looksLikeBusinessCode(separatedParts[separatedParts.length - 1])) return separatedParts.slice(0, -1).join(" — ");
  }
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

  const embeddedCode = value.match(/^(.+?)\s+(?:—|–|·|\||:)\s+([A-Za-z0-9._/#-]+)\s+(?:—|–|·|\||:)\s+(.+)$/);
  if (embeddedCode) {
    const left = embeddedCode[1].trim();
    const code = embeddedCode[2].trim();
    const right = embeddedCode[3].trim();
    if (looksLikeBusinessCode(code) && left && right) return `${left} — ${right}`;
  }

  return value;
}

function collectOptions(children: ReactNode, preserveLabel = false, groupDisabled = false): Option[] {
  const result: Option[] = [];
  Children.forEach(children, child => {
    if (!isValidElement(child)) return;
    const element = child as ReactElement<{ value?: string | number; disabled?: boolean; children?: ReactNode; "data-search"?: string }>;
    if (element.type === "option") {
      const rawLabel = textOf(element.props.children).trim() || String(element.props.value ?? "");
      const hiddenSearch = String(element.props["data-search"] ?? "").trim();
      result.push({ value: String(element.props.value ?? rawLabel), label: preserveLabel ? rawLabel : displayLabel(rawLabel), searchText: `${rawLabel} ${hiddenSearch}`.trim(), disabled: groupDisabled || Boolean(element.props.disabled) });
      return;
    }
    if (element.type === "optgroup" || element.type === Fragment) result.push(...collectOptions(element.props.children, preserveLabel, groupDisabled || Boolean(element.props.disabled)));
  });
  return result;
}

export default function SearchableSelect({
  children,
  className = "",
  wrapperClassName = "",
  value,
  defaultValue,
  onChange,
  disabled,
  name,
  id,
  searchPlaceholder = "Type to search...",
  emptyText = "No matching option",
  preserveLabel = false,
  nativeCompatibility = false,
  ...props
}: Props) {
  const options = useMemo(() => collectOptions(children, preserveLabel), [children, preserveLabel]);
  const controlled = value !== undefined;
  const [internalValue, setInternalValue] = useState(String(defaultValue ?? ""));
  const selectedValue = controlled ? String(value ?? "") : internalValue || (nativeCompatibility && defaultValue === undefined ? options[0]?.value ?? "" : internalValue);
  const selected = options.find(option => option.value === selectedValue) ?? null;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [dropdownPosition, setDropdownPosition] = useState<DropdownPosition | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const positionDropdown = () => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    const availableBelow = window.innerHeight - rect.bottom - 8;
    const openAbove = availableBelow < 220 && rect.top > availableBelow;
    const estimatedHeight = Math.min(288, 53 + options.length * 36);
    const popupWidth = Math.min(Math.max(rect.width, 180), Math.max(1, window.innerWidth - 16));
    setDropdownPosition({
      left: Math.max(8, Math.min(rect.left, window.innerWidth - popupWidth - 8)),
      top: openAbove ? Math.max(8, rect.top - estimatedHeight - 4) : rect.bottom + 4,
      width: popupWidth,
    });
  };

  const closeDropdown = () => {
    setOpen(false);
    setQuery("");
    setDropdownPosition(null);
  };

  const openDropdown = () => {
    positionDropdown();
    setOpen(true);
    setQuery("");
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  useEffect(() => {
    const closeOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !(target instanceof Element && target.closest("[data-navilo-searchable-dropdown]"))) closeDropdown();
    };
    document.addEventListener("mousedown", closeOutside);
    return () => document.removeEventListener("mousedown", closeOutside);
  }, []);

  useEffect(() => {
    if (!open) return;
    const reposition = (event: Event) => {
      const target = event.target;
      if (target instanceof Element && target.closest("[data-navilo-searchable-dropdown]")) return;
      positionDropdown();
    };
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open, options.length]);

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
    closeDropdown();
  };

  const Trigger = nativeCompatibility ? "span" : "button";
  const nativeLayout = className.split(/\s+/).filter(token => /^(?:w-|min-w-|max-w-|flex-|grow|shrink|col-|row-|m[trblxy]?-|self-)/.test(token)).join(" ");
  return (
    <div ref={rootRef} data-print-control={selected?.label || ""} data-print-label={props["aria-label"]} className={`relative min-w-0 ${wrapperClassName || (nativeCompatibility && nativeLayout ? nativeLayout : "w-full")}`}>
      <Trigger
        role={nativeCompatibility ? "button" : undefined}
        aria-hidden={nativeCompatibility ? true : undefined}
        tabIndex={nativeCompatibility ? -1 : undefined}
        aria-disabled={disabled}
        ref={node => { triggerRef.current = node as HTMLButtonElement | null; }}
        id={nativeCompatibility ? undefined : id}
        type="button"
        disabled={disabled}
        className={`${className} ${nativeCompatibility && disabled ? "cursor-not-allowed opacity-50" : ""} flex w-full items-center justify-between gap-2 text-left`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={nativeCompatibility ? undefined : props["aria-label"]}
        aria-required={props.required}
        onBlur={nativeCompatibility ? undefined : props.onBlur as unknown as React.FocusEventHandler<HTMLButtonElement>}
        title={props.title}
        onClick={() => {
          if (disabled) return;
          if (open) closeDropdown(); else openDropdown();
        }}
      >
        <span data-selected-label={nativeCompatibility ? selected?.label || "Select..." : undefined} className={`${nativeCompatibility ? "navilo-select-display" : ""} min-w-0 flex-1 truncate ${selectedValue ? "text-slate-900" : "text-slate-500"}`}>
          {nativeCompatibility ? null : selected?.label || "Select..."}
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </Trigger>

      {open && dropdownPosition && createPortal(
        <div
          data-navilo-searchable-dropdown
          className="fixed z-[2147483000] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl"
          style={{ left: dropdownPosition.left, top: dropdownPosition.top, width: dropdownPosition.width }}
          onKeyDown={event => {
            if (event.key === "Escape") closeDropdown();
          }}
        >
          <div className="border-b border-slate-100 p-2">
            <div className="flex h-9 items-center gap-2 rounded-md border border-slate-300 bg-white px-2 focus-within:border-primary-500 focus-within:ring-1 focus-within:ring-primary-500">
              <Search className="h-4 w-4 shrink-0 text-slate-400" />
              <input ref={inputRef} value={query} onChange={event => setQuery(event.target.value)} placeholder={searchPlaceholder} className="min-w-0 flex-1 border-0 bg-transparent text-sm outline-none placeholder:text-slate-400" autoComplete="off" />
            </div>
          </div>
          <div role="listbox" className="max-h-60 overscroll-contain overflow-y-auto p-1" onWheel={event => event.stopPropagation()}>
            {filtered.length ? filtered.map(option => (
              <button key={`${option.value}-${option.searchText}`} type="button" role="option" aria-selected={option.value === selectedValue} disabled={option.disabled} onMouseDown={event => event.preventDefault()} onClick={() => commit(option.value)} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-slate-700 hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-40">
                <span className="min-w-0 flex-1 break-words">{option.label || "—"}</span>
                {option.value === selectedValue && <Check className="h-4 w-4 shrink-0 text-blue-600" />}
              </button>
            )) : <div className="px-3 py-4 text-center text-sm text-slate-500">{emptyText}</div>}
          </div>
        </div>,
        document.body,
      )}
      {nativeCompatibility && <select
        {...props}
        className="sr-only" tabIndex={nativeCompatibility ? 0 : -1} aria-hidden={nativeCompatibility ? open : true}
        id={nativeCompatibility ? id : undefined} aria-label={nativeCompatibility ? props["aria-label"] : undefined}
        onFocus={event => { props.onFocus?.(event); openDropdown(); }}
        name={name} value={selectedValue} disabled={disabled} required={props.required} form={props.form}
        onChange={event => { if (!controlled) setInternalValue(event.target.value); onChange?.(event); closeDropdown(); }}
        onInvalid={event => { event.preventDefault(); triggerRef.current?.focus(); openDropdown(); }}
      >{children}</select>}
      {!nativeCompatibility && name ? <input type="hidden" name={name} value={selectedValue} /> : null}
    </div>
  );
}
