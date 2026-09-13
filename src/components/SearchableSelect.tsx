import type { ReactNode, SelectHTMLAttributes } from "react";

type Props = SelectHTMLAttributes<HTMLSelectElement> & {
  children: ReactNode;
  searchPlaceholder?: string;
  emptyText?: string;
};

export default function SearchableSelect({
  children,
  className = "",
  searchPlaceholder: _searchPlaceholder,
  emptyText: _emptyText,
  ...props
}: Props) {
  return (
    <select
      {...props}
      className={`${className} w-full`}
    >
      {children}
    </select>
  );
}
