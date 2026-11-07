import { useState, type FormEvent } from "react";
import { useTranslation } from "../i18n/i18n.tsx";
import type { MessageKey } from "../i18n/messages.ts";
import { Alert } from "../ui/alert.tsx";
import { Button } from "../ui/button.tsx";
import { Field } from "../ui/field.tsx";

/** What is wrong with the form, as keys of the message catalogue. Empty when it can be sent. */
export function validateSignIn(email: string, password: string): { email?: MessageKey; password?: MessageKey } {
  const problems: { email?: MessageKey; password?: MessageKey } = {};
  const trimmed = email.trim();
  if (trimmed === "") problems.email = "signIn.emailRequired";
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) problems.email = "signIn.emailInvalid";
  if (password === "") problems.password = "signIn.passwordRequired";
  return problems;
}

/**
 * The shape of the sign-in page, ready for task AC-01. Nothing is sent yet: the API has no sign-in route
 * (its authenticator refuses everyone), so a valid form ends with a clear message instead of a request that
 * cannot succeed. The password is held in the form only and is never written anywhere.
 */
export function SignInPage() {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [problems, setProblems] = useState<{ email?: MessageKey; password?: MessageKey }>({});
  const [sent, setSent] = useState(false);

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const found = validateSignIn(email, password);
    setProblems(found);
    setSent(found.email === undefined && found.password === undefined);
  };

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4">
      <h1 className="text-2xl font-semibold">{t("signIn.title")}</h1>
      <Alert tone="notice">{t("signIn.notice")}</Alert>
      <form noValidate onSubmit={submit} className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5">
        <Field
          label={t("signIn.email")}
          type="email"
          name="email"
          autoComplete="username"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={problems.email === undefined ? undefined : t(problems.email)}
        />
        <Field
          label={t("signIn.password")}
          type="password"
          name="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          error={problems.password === undefined ? undefined : t(problems.password)}
        />
        <Button type="submit">{t("signIn.submit")}</Button>
        {sent ? <Alert tone="notice">{t("signIn.unavailable")}</Alert> : null}
      </form>
    </div>
  );
}
