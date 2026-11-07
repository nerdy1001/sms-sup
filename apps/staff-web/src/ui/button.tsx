import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "./cn.ts";

const button = cva(
  "inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-60",
  {
    variants: {
      variant: {
        primary: "bg-brand text-brand-ink hover:bg-blue-900",
        secondary: "border border-line bg-surface text-ink hover:bg-slate-100",
      },
    },
    defaultVariants: { variant: "primary" },
  },
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof button> {
  /** Render the child element (for example a link) with the look of a button. */
  readonly asChild?: boolean;
}

export function Button({ className, variant, asChild = false, type = "button", ...rest }: ButtonProps) {
  const Component = asChild ? Slot : "button";
  return <Component className={cn(button({ variant }), className)} {...(asChild ? {} : { type })} {...rest} />;
}
