import { useState } from "react";
import type { ReactNode } from "react";
import { ConfirmModal } from "@/components/ui";

type Props = {
  title: string;
  message: string;
  onConfirm: () => void | Promise<void>;
  children: ReactNode;
  className?: string;
  tone?: "danger" | "neutral";
};

export default function MasterActionButton({ title, message, onConfirm, children, className = "btn-secondary inline-flex items-center gap-1 px-2 py-1 text-xs", tone = "neutral" }: Props) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className={className} onClick={() => setOpen(true)}>{children}</button>
    <ConfirmModal
      open={open}
      title={title}
      message={message}
      tone={tone}
      onCancel={() => setOpen(false)}
      onConfirm={() => { setOpen(false); void onConfirm(); }}
    />
  </>;
}
