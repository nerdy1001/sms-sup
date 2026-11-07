import { isApiError } from "./api/client.ts";
import { useTranslation } from "./i18n/i18n.tsx";
import type { MessageKey } from "./i18n/messages.ts";
import { Alert } from "./ui/alert.tsx";

/** The words for any failure: the message for its code, and the reference to give to support. */
export function ErrorMessage(props: { readonly error: unknown }) {
  const { t } = useTranslation();
  const known = isApiError(props.error);
  const key: MessageKey = known ? `error.${props.error.code}` : "error.unexpected";
  const reference = known ? props.error.requestId : undefined;
  return (
    <Alert tone="error">
      <p>{t(key)}</p>
      {reference === undefined ? null : <p className="mt-1 font-mono text-xs">{t("error.reference", { reference })}</p>}
    </Alert>
  );
}
