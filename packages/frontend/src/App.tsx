import React, { useEffect, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { Sidebar } from "./components/Sidebar";

export default function App() {
  const [status, setStatus] = useState("loading...");
  const loc = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    fetch("/api/health")
      .then(async (r) => setStatus((await r.json()).status))
      .catch(() => setStatus("offline"));
  }, []);

  return (
    <div className="h-dvh bg-neutral-900 text-white">
      {/* Fixed sidebar */}
      <div className="fixed inset-y-0 left-0 w-16">
        <Sidebar current={loc.pathname} onNavigate={navigate} />
      </div>
      {/* Main column shifted right of sidebar */}
      <div className="ml-16 h-full flex flex-col">
        <header className="sticky top-0 z-10 p-4 border-b border-neutral-800 flex items-center justify-between bg-neutral-900/95 backdrop-blur">
          <h1 className="text-xl font-semibold">Tagify</h1>
          <div className="text-sm text-neutral-300">Backend: {status}</div>
        </header>
        <div className="flex-1 overflow-auto">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
