import { useCallback, useEffect, useState } from "react";
import { getHealth, getReady } from "../api/status.ts";
import { ErrorMessage } from "../error-message.tsx";
import { useTranslation } from "../i18n/i18n.tsx";
import { Alert } from "../ui/alert.tsx";
import { Button } from "../ui/button.tsx";

type Check<T> =
  { readonly state: "checking" } | { readonly state: "done"; readonly value: T } | { readonly state: "failed"; readonly error: unknown };

type Outcome<T> = { readonly state: "done"; readonly value: T } | { readonly state: "failed"; readonly error: unknown };

/**
 * Runs a check now and again each time `again` changes. The answer is stored with the round it belongs to,
 * so the page is "checking" whenever the stored answer is from an earlier round, and an answer that arrives
 * after the page moved on is ignored.
 */
function useCheck<T>(run: (signal: AbortSignal) => Promise<T>, again: number): Check<T> {
  const [settled, setSettled] = useState<{ readonly round: number; readonly outcome: Outcome<T> }>();
  useEffect(() => {
    const controller = new AbortController();
    run(controller.signal).then(
      (value) => {
        if (!controller.signal.aborted) setSettled({ round: again, outcome: { state: "done", value } });
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setSettled({ round: again, outcome: { state: "failed", error } });
      },
    );
    return () => controller.abort();
  }, [run, again]);
  return settled === undefined || settled.round !== again ? { state: "checking" } : settled.outcome;
}

export function HomePage() {
  const { t } = useTranslation();
  const [round, setRound] = useState(0);
  const retry = useCallback(() => setRound((value) => value + 1), []);
  const health = useCheck(getHealth, round);
  const ready = useCheck(getReady, round);

  return (
    <div className="flex flex-col gap-6">
      <section>
        <h1 className="text-2xl font-semibold">{t("home.title")}</h1>
        <p className="mt-2 max-w-2xl text-muted">{t("home.intro")}</p>
      </section>

      <section aria-labelledby="status-title" className="rounded-lg border border-line bg-surface p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="status-title" className="text-lg font-semibold">
            {t("status.title")}
          </h2>
          <Button variant="secondary" onClick={retry}>
            {t("status.retry")}
          </Button>
        </div>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-sm text-muted">{t("status.service")}</dt>
            <dd className="mt-1">
              {health.state === "checking" ? <span>{t("status.checking")}</span> : null}
              {health.state === "done" ? (
                <Alert tone="success">
                  <p className="font-semibold">{t("status.running")}</p>
                  <p className="font-mono text-xs">{t("status.version", { version: health.value.version })}</p>
                </Alert>
              ) : null}
              {health.state === "failed" ? <ErrorMessage error={health.error} /> : null}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-muted">{t("status.database")}</dt>
            <dd className="mt-1">
              {ready.state === "checking" ? <span>{t("status.checking")}</span> : null}
              {ready.state === "done" ? (
                <Alert tone="success">
                  <p className="font-semibold">{t("status.ready")}</p>
                </Alert>
              ) : null}
              {ready.state === "failed" ? (
                <>
                  <p className="mb-2 font-semibold text-danger">{t("status.notReady")}</p>
                  <ErrorMessage error={ready.error} />
                </>
              ) : null}
            </dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
