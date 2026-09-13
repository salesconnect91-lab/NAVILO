import { Children, isValidElement, useId, useMemo, useState } from "react";
import type { ChangeEvent, ReactElement, ReactNode, SelectHTMLAttributes } from "react";

type Props = Omit<SelectHTMLAttributes<HTMLSelectElement>, "children"> & {
  children: ReactNode;
  searchPlaceholder?: string;
  emptyText?: string;
};

type Option = { value: string; label: string; disabled: boolean };

function textOf(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement(node)) return textOf((node.props as { children?: ReactNode }).children);
  return "";
}

function collectOptions(children: ReactNode): Option[] {
  const result: Option[] = [];
  Children.forEach(children, child => {
    if (!isValidElement(child)) return;
    const element = child as ReactElement<{ value?: string | number; disabled?: boolean; children?: ReactNode }>;
    if (element.type === "option") {
      result.push({
        value: String(element.props.value ?? ""),
        label: textOf(element.props.children).trim(),
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
  required,
  name,
  id,
  searchPlaceholder = "Type to search...",
  ...props
}: Props) {
  const generatedId = useId().replace(/:/g, "");
  const listId = `navilo-select-${generatedId}`;
  const options = useMemo(() => collectOptions(children), [children]);
  const initialValue = String(value ?? defaultValue ?? "");
  const [internalValue, setInternalValue] = useState(initialValue);
  const selectedValue = value !== undefined ? String(value ?? "") : internalValue;
  const selected = options.find(option => option.value === selectedValue);
  const display = selected?.label ?? "";

  const commit = (next: string) => {
    const match = options.find(option => !option.disabled && (option.label === next || option.value === next));
    if (!match) return;
    if (value === undefined) setInternalValue(match.value);
    if (onChange) {
      const target = { value: match.value, name: name ?? "" } as HTMLSelectElement;
      onChange({ target, currentTarget: target } as ChangeEvent<HTMLSelectElement>);
    }
  };

  return (
    <>
      <input
        id={id}
        className={`${className} w-full`}
        list={listId}
        value={display}
        disabled={disabled}
        required={required}
        placeholder={searchPlaceholder}
        autoComplete="off"
        onChange={event => commit(event.target.value)}
        onBlur={event => {
          if (!options.some(option => option.label === event.currentTarget.value)) event.currentTarget.value = display;
        }}
        aria-label={props["aria-label"]}
        title={props.title}
      />
      <datalist id={listId}>
        {options.filter(option => !option.disabled).map(option => (
          <option key={`${option.value}-${option.label}`} value={option.label} />
        ))}
      </datalist>
      {name ? <input type="hidden" name={name} value={selectedValue} /> : null}
    </>
  );
}
