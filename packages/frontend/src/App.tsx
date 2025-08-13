import React, { useEffect, useMemo, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { Sidebar } from "./components/Sidebar";
import { Tag } from "lucide-react";

export default function App() {
  const [status, setStatus] = useState("loading");
  const loc = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    fetch("/api/health")
      .then(async (r) => setStatus((await r.json()).status))
      .catch(() => setStatus("offline"));
  }, []);

  const statusClasses = useMemo(() => {
    switch (status) {
      case "ok":
        return {
          container: "bg-emerald-900/25 border-emerald-700 text-emerald-200",
          dot: "bg-emerald-400",
        };
      case "offline":
        return {
          container: "bg-red-900/25 border-red-700 text-red-200",
          dot: "bg-red-400",
        };
      default:
        return {
          container: "bg-amber-900/25 border-amber-700 text-amber-200",
          dot: "bg-amber-400 animate-pulse",
        };
    }
  }, [status]);

  return (
    <div className="h-dvh bg-neutral-900 text-white">
      {/* Fixed sidebar */}
      <div className="fixed inset-y-0 left-0 w-16">
        <Sidebar current={loc.pathname} onNavigate={navigate} />
      </div>
      {/* Main column shifted right of sidebar */}
      <div className="ml-16 h-full flex flex-col">
        <header className="sticky top-0 z-10 p-4 border-b border-neutral-800 flex items-center justify-between bg-neutral-900/95 backdrop-blur">
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2 select-none">
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 via-fuchsia-500 to-blue-500 text-white">
              <Tag size={18} />
            </span>
            <span className="bg-gradient-to-br from-purple-400 via-fuchsia-300 to-blue-300 bg-clip-text text-transparent">
              Tagify
            </span>
          </h1>
          <div
            className={
              "inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border " +
              statusClasses.container
            }
            aria-label={`Backend status: ${status}`}
            title={`Backend: ${status}`}
          >
            <span className="opacity-90">Backend</span>
            <span
              className={`ml-1 h-2 w-2 rounded-full shadow-[0_0_0_1px_rgba(0,0,0,0.25)] ${statusClasses.dot}`}
            />
          </div>
        </header>
        <div className="flex-1 overflow-auto">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
