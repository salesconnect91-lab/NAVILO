import { Children, Fragment, isValidElement, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactElement, type ReactNode, type SelectHTMLAttributes } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search } from "lucide-react";

type FlatOption = {
  value: string;
  label: string;
  disabled: boolean;
  group?: string;
};

type Props = SelectHTMLAttributes<HTMLSelectElement> & {
  children: ReactNode;
  searchPlaceholder?: string;
  emptyText?: string;
};

type MenuPosition = {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
};

function nodeText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join("");
  if (isValidElement(node)) return nodeText((node as ReactElement<any>).props?.children);
  return "";
}

function flattenOptions(children: ReactNode, group?: string): FlatOption[] {
  const out: FlatOption[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    const element = child as ReactElement<any>;
    if (element.type === Fragment) {
      out.push(...flattenOptions(element.props.children, group));
      return;
    }
    if (element.type === "optgroup") {
      out.push(...flattenOptions(element.props.children, String(element.props.label ?? "")));
      return;
    }
    if (element.type === "option") {
      const rawValue = element.props.value ?? "";
      const explicitLabel = element.props.label == null ? "" : String(element.props.label);
      const childLabel = nodeText(element.props.children).trim();
      const label = explicitLabel.trim() || childLabel || String(rawValue);
      out.push({ value: String(rawValue), label, disabled: Boolean(element.props.disabled), group });
      return;
    }
    if (element.props?.children) out.push(...flattenOptions(element.props.children, group));
  });
  return out;
}

function stripLeadingAccountCode(label: string) {
  return label.replace(/^\s*[A-Z]{0,4}[-/]?\d{2,10}(?:[./-]\d+)?\s*(?:[-–—:|]\s*)+/, "").trim() || label;
}

export default function SearchableSelect({
  children,
  value,
  defaultValue,
  onChange,
  disabled,
  className = "",
  searchPlaceholder = "Type to search...",
  emptyText = "No matching option",
  multiple,
  size,
  name,
  id,
  "aria-label": ariaLabel,
  ...rest
}: Props) {
  if (multiple || (typeof size === "number" && size > 1)) {
    return <select {...rest} name={name} id={id} aria-label={ariaLabel} multiple={multiple} size={size} value={value} defaultValue={defaultValue} onChange={onChange} disabled={disabled} className={className}>{children}</select>;
  }

  const options = useMemo(() => flattenOptions(children), [children]);
  const controlledValue = value == null ? undefined : String(value);
  const initialValue = controlledValue ?? (defaultValue == null ? "" : String(defaultValue));
  const [internalValue, setInternalValue] = useState(initialValue);
  const selectedValue = controlledValue ?? internalValue;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);
  const [nearbyAccountContext, setNearbyAccountContext] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const selectRef = useRef<HTMLSelectElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const explicitAccountContext = useMemo(() => {
    const hint = [name, id, ariaLabel, searchPlaceholder]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase();
    return hint.includes("account") || hint.includes("اکاؤنٹ");
  }, [name, id, ariaLabel, searchPlaceholder]);

  useEffect(() => {
    const host = rootRef.current;
    if (!host) return;
    const parentText = host.parentElement?.querySelector("label")?.textContent ?? "";
    const normalized = parentText.toLocaleLowerCase();
    setNearbyAccountContext(normalized.includes("account") || normalized.includes("اکاؤنٹ"));
  }, [children]);

  const accountContext = explicitAccountContext || nearbyAccountContext;
  const visibleLabel = (label: string) => accountContext ? stripLeadingAccountCode(label) : label;

  useEffect(() => {
    if (controlledValue !== undefined) setInternalValue(controlledValue);
  }, [controlledValue]);

  const updateMenuPosition = () => {
    const button = buttonRef.current;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    const viewportPadding = 8;
    const below = window.innerHeight - rect.bottom - viewportPadding;
    const above = rect.top - viewportPadding;
    const openUpward = below < 190 && above > below;
    const available = Math.max(128, Math.min(280, openUpward ? above : below));
    setMenuPosition({
      left: Math.max(viewportPadding, Math.min(rect.left, window.innerWidth - rect.width - viewportPadding)),
      top: openUpward ? Math.max(viewportPadding, rect.top - available - 4) : rect.bottom + 4,
      width: rect.width,
      maxHeight: available,
    });
  };

  useEffect(() => {
    if (!open) return;
    updateMenuPosition();
    const reposition = () => updateMenuPosition();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open]);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const selected = useMemo(
    () => options.find((option) => option.value === selectedValue) ?? options.find((option) => option.value === "") ?? null,
    [options, selectedValue],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    return options
      .filter((option) => option.value !== "" || !q)
      .filter((option) => !q || `${option.label} ${visibleLabel(option.label)} ${option.group ?? ""}`.toLocaleLowerCase().includes(q))
      .slice(0, 150);
  }, [options, query, accountContext]);

  const commit = (nextValue: string) => {
    const option = options.find((candidate) => candidate.value === nextValue);
    if (option?.disabled || disabled) return;
    if (controlledValue === undefined) setInternalValue(nextValue);
    const source = selectRef.current;
    if (source) {
      source.value = nextValue;
      if (onChange) {
        const eventLike = {
          target: source,
          currentTarget: source,
          type: "change",
          bubbles: true,
          cancelable: false,
          defaultPrevented: false,
          eventPhase: 3,
          isTrusted: false,
          nativeEvent: new Event("change", { bubbles: true }),
          preventDefault() {},
          isDefaultPrevented: () => false,
          stopPropagation() {},
          isPropagationStopped: () => false,
          persist() {},
          timeStamp: Date.now(),
        } as unknown as ChangeEvent<HTMLSelectElement>;
        onChange(eventLike);
      }
    }
    setOpen(false);
    setQuery("");
    requestAnimationFrame(() => buttonRef.current?.focus());
  };

  const openMenu = () => {
    if (disabled || open) return;
    setOpen(true);
    setQuery("");
    const currentIndex = options.findIndex((option) => option.value === selectedValue && !option.disabled);
    setActiveIndex(currentIndex >= 0 ? currentIndex : Math.max(0, options.findIndex((option) => !option.disabled)));
    requestAnimationFrame(() => {
      updateMenuPosition();
      inputRef.current?.focus();
    });
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      setQuery("");
      buttonRef.current?.focus();
      return;
    }
    if (!filtered.length) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      let next = activeIndex;
      for (let i = 0; i < filtered.length; i += 1) {
        next = (next + direction + filtered.length) % filtered.length;
        if (!filtered[next]?.disabled) break;
      }
      setActiveIndex(next);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const option = filtered[activeIndex] ?? filtered.find((candidate) => !candidate.disabled);
      if (option && !option.disabled) commit(option.value);
    }
  };

  const displayLabel = selected ? visibleLabel(selected.label) : (selectedValue ? selectedValue : "Select...");

  const menu = open && menuPosition && typeof document !== "undefined" ? createPortal(
    <div
      ref={menuRef}
      className="erp-searchable-menu fixed z-[9999] overflow-hidden border border-slate-200 bg-white shadow-xl"
      style={{ left: menuPosition.left, top: menuPosition.top, width: menuPosition.width, maxHeight: menuPosition.maxHeight }}
    >
      <div className="border-b border-slate-100 p-2">
        <div className="flex h-8 items-center gap-2 rounded-md border border-slate-300 bg-white px-2 focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500">
          <Search className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }}
            onKeyDown={handleKeyDown}
            placeholder={searchPlaceholder}
            className="min-w-0 flex-1 border-0 bg-transparent text-[13px] text-slate-900 outline-none placeholder:text-slate-400"
            autoComplete="off"
          />
        </div>
      </div>
      <div role="listbox" className="overflow-auto p-1" style={{ maxHeight: Math.max(88, menuPosition.maxHeight - 49) }}>
        {!filtered.length ? (
          <div className="px-3 py-4 text-center text-[12px] text-slate-500">{emptyText}</div>
        ) : filtered.map((option, index) => (
          <button
            key={`${option.group ?? ""}:${option.value}:${index}`}
            type="button"
            role="option"
            aria-selected={option.value === selectedValue}
            disabled={option.disabled}
            onMouseEnter={() => setActiveIndex(index)}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => commit(option.value)}
            className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] ${index === activeIndex ? "bg-blue-50 text-blue-700" : "text-slate-700 hover:bg-slate-50"} disabled:cursor-not-allowed disabled:opacity-40`}
          >
            <span className="min-w-0 flex-1">
              {option.group && <span className="mr-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">{option.group} ·</span>}
              <span className="break-words">{visibleLabel(option.label) || option.value || "—"}</span>
            </span>
            {option.value === selectedValue && <Check className="h-3.5 w-3.5 shrink-0" />}
          </button>
        ))}
      </div>
    </div>,
    document.body,
  ) : null;

  return (
    <div ref={rootRef} className="relative min-w-0 w-full">
      <select
        {...rest}
        name={name}
        id={id}
        aria-label={ariaLabel}
        ref={selectRef}
        value={selectedValue}
        onChange={onChange}
        disabled={disabled}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
      >
        {children}
      </select>

      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        onClick={openMenu}
        onKeyDown={(event) => {
          if ((event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") && !open) {
            event.preventDefault();
            openMenu();
          }
        }}
        className={`${className} flex min-h-8 w-full items-center justify-between gap-2 text-left text-slate-900 disabled:cursor-not-allowed disabled:opacity-60`}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className={`min-w-0 flex-1 truncate ${selectedValue ? "text-slate-900" : "text-slate-500"}`}>{displayLabel}</span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {menu}
    </div>
  );
}
