import { cva, type VariantProps } from "class-variance-authority";
import { CircleAlert, CircleCheck, Info } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "./cn.ts";

const alert = cva("rounded-md border px-4 py-3 text-sm", {
  variants: {
    tone: {
      error: "border-danger bg-danger-wash text-danger",
      success: "border-ok bg-ok-wash text-ok",
      notice: "border-notice bg-notice-wash text-notice",
    },
  },
  defaultVariants: { tone: "notice" },
});

export interface AlertProps extends VariantProps<typeof alert> {
  readonly children: ReactNode;
  readonly className?: string;
}

/** An error is announced at once (role alert); anything else is read when the person reaches it (role status). */
export function Alert({ tone, className, children }: AlertProps) {
  // The icon repeats what the colour says, so that the meaning does not depend on seeing the colour.
  const Icon = tone === "error" ? CircleAlert : tone === "success" ? CircleCheck : Info;
  return (
    <div role={tone === "error" ? "alert" : "status"} className={cn(alert({ tone }), "flex items-start gap-3", className)}>
      <Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
      <div>{children}</div>
    </div>
  );
}
