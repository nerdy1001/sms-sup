import { useId, type InputHTMLAttributes } from "react";
import { cn } from "./cn.ts";

export interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  readonly label: string;
  /** The message shown under the field when its content is not valid. */
  readonly error?: string | undefined;
}

/**
 * A labelled text field. The label is tied to the input, and a problem is announced to screen readers
 * and tied to the input as well, so that nobody has to guess which field a message is about.
 */
export function Field({ label, error, className, ...rest }: FieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={error === undefined ? undefined : errorId}
        className={cn(
          "rounded-md border bg-surface px-3 py-2 text-base text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand",
          error === undefined ? "border-line" : "border-danger",
          className,
        )}
        {...rest}
      />
      {error === undefined ? null : (
        <p id={errorId} className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
