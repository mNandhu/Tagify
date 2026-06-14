import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import "./masonry.css";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import OverviewPage from "./pages/OverviewPage";
import AllImagesPage from "./pages/AllImagesPage";
import LibrariesPage from "./pages/LibrariesPage";
import TagsPage from "./pages/TagsPage";
import SettingsPage from "./pages/SettingsPage";
import RulesPage from "./pages/RulesPage";
import ImageView from "./pages/ImageView";
import { ToastProvider } from "./components/Toasts";

const router = createBrowserRouter([
  {
    path: "/",
    element: <App />,
    children: [
      { index: true, element: <AllImagesPage /> },
      { path: "overview", element: <OverviewPage /> },
      { path: "libraries", element: <LibrariesPage /> },
      { path: "tags", element: <TagsPage /> },
      { path: "rules", element: <RulesPage /> },
      { path: "settings", element: <SettingsPage /> },
    ],
  },
  { path: "/image/:id", element: <ImageView /> },
]);

// Server-state cache. staleTime keeps the Image feed warm so navigating
// gallery -> ImageView -> gallery reuses already-fetched pages instead of refetching.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
    },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>
  </React.StrictMode>
);
