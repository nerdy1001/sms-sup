import { Link } from "react-router";
import { useTranslation } from "../i18n/i18n.tsx";

export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-2xl font-semibold">{t("notFound.title")}</h1>
      <p className="text-muted">{t("notFound.body")}</p>
      <Link
        to="/"
        className="w-fit text-brand underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        {t("notFound.back")}
      </Link>
    </div>
  );
}
