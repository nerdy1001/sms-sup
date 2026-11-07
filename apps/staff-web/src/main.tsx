import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "./app.tsx";
import { LanguageProvider } from "./i18n/i18n.tsx";
import "./styles.css";

const root = document.getElementById("root");
if (root === null) throw new Error("The page has no element with the id root.");

createRoot(root).render(
  <StrictMode>
    <LanguageProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </LanguageProvider>
  </StrictMode>,
);
