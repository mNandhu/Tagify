import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import "./masonry.css";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import App from "./App";
import AllImagesPage from "./pages/AllImagesPage";
import LibrariesPage from "./pages/LibrariesPage";
import TagsPage from "./pages/TagsPage";
import SettingsPage from "./pages/SettingsPage";
import ImageView from "./pages/ImageView";
import { ToastProvider } from "./components/Toasts";

const router = createBrowserRouter([
  {
    path: "/",
    element: <App />,
    children: [
      { index: true, element: <AllImagesPage /> },
      { path: "libraries", element: <LibrariesPage /> },
      { path: "tags", element: <TagsPage /> },
      { path: "settings", element: <SettingsPage /> },
    ],
  },
  { path: "/image/:id", element: <ImageView /> },
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ToastProvider>
      <RouterProvider router={router} />
    </ToastProvider>
  </React.StrictMode>
);
