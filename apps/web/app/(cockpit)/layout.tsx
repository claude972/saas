"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Sidebar } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";
import { isAuthenticated } from "@/lib/auth";
import { Spinner } from "@/components/ui/Spinner";

export default function CockpitLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  // Client-side auth guard: the token lives in localStorage, so this check
  // can only run after mount.
  useEffect(() => {
    if (!isAuthenticated()) {
      router.replace("/login");
      return;
    }
    setReady(true);
  }, [router]);

  if (!ready) {
    return (
      <div className="grid h-screen place-items-center bg-bg">
        <Spinner size={26} />
      </div>
    );
  }

  return (
    <div className="grid h-screen grid-rows-[54px_minmax(0,1fr)] border-t-2 border-amber">
      <Topbar />
      <div className="grid min-h-0 grid-cols-[252px_minmax(0,1fr)]">
        <Sidebar />
        <main className="min-h-0 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
