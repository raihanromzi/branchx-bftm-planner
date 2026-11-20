"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

export function JadwalScreen() {
  const [view, setView] = useState<"day" | "week">("day");
  const [date, setDate] = useState(new Date());

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b p-4">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-20 font-600">Jadwal</h1>
          <div className="flex gap-2">
            <Button variant={view === "day" ? "default" : "outline"} onClick={() => setView("day")} size="sm">
              Hari
            </Button>
            <Button variant={view === "week" ? "default" : "outline"} onClick={() => setView("week")} size="sm">
              Minggu
            </Button>
          </div>
        </div>
        {/* Date picker */}
        <input type="date" value={date.toISOString().split("T")[0]} onChange={(e) => setDate(new Date(e.target.value))} className="text-14 p-2 border rounded w-full" />
      </div>

      {/* Activities list (placeholder) */}
      <div className="p-4">
        <div className="text-center py-8 text-muted-foreground">
          <p>Belum ada Kegiatan.</p>
          <p className="text-14">Gunakan tombol di bawah untuk menambahkan.</p>
        </div>
      </div>

      {/* Floating action button */}
      <div className="fixed bottom-24 right-4 safe-area-bottom">
        <Button size="lg" className="rounded-full w-14 h-14">
          <Plus />
        </Button>
      </div>
    </div>
  );
}
