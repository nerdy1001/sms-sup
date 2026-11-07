import { Route, Routes } from "react-router";
import { Shell } from "./layout/shell.tsx";
import { HomePage } from "./pages/home.tsx";
import { NotFoundPage } from "./pages/not-found.tsx";
import { SignInPage } from "./pages/sign-in.tsx";

/** The pages of the application. A module that adds pages adds its routes here. */
export function App() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<HomePage />} />
        <Route path="sign-in" element={<SignInPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
