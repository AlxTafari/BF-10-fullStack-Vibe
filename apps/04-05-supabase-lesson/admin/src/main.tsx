import { createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Provider } from "react-redux";
import { startAuthListener } from "./api/session";
import { store } from "./api/store";
import { routeTree } from "./routeTree.gen";
import "./styles/globals.css";

// basepath — подпапка, из которой раздаётся админка (GitHub Pages: /<репозиторий>/), локально "/".
// Значение — base из vite.config.ts, чтобы роутер и пути к ассетам не разъехались.
const router = createRouter({ routeTree, basepath: import.meta.env.BASE_URL });

startAuthListener();

// Регистрация типов роутера: ссылки и params становятся типобезопасными.
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Provider store={store}>
      <RouterProvider router={router} />
    </Provider>
  </StrictMode>,
);
