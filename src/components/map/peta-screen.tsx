"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

export function PetaScreen() {
  const [view, setView] = useState<"map" | "list">("map");

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="border-b p-4 flex justify-between items-center">
        <h1 className="text-20 font-600">Peta</h1>
        <Button variant="outline" size="sm" onClick={() => setView(view === "map" ? "list" : "map")}>
          {view === "map" ? "Daftar" : "Peta"}
        </Button>
      </div>

      {/* Map placeholder or list */}
      <div className="flex-1 flex items-center justify-center bg-surface">
        <div className="text-center text-muted-foreground">
          <p>Belum ada Prospect dengan lokasi.</p>
          <p className="text-14">Tambahkan lokasi ke Prospect untuk melihatnya di peta.</p>
        </div>
      </div>
    </div>
  );
}
