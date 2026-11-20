"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

export function TargetScreen() {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b p-4">
        <h1 className="text-20 font-600 mb-4">Target</h1>
        <label className="block text-14 font-500 mb-2">Bulan</label>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-full p-2 border rounded" />
      </div>

      <div className="p-4 space-y-4">
        <p className="text-muted-foreground text-14">Atur target rekening baru untuk setiap Funding Officer aktif.</p>
        <div className="text-center py-8 text-muted-foreground">Belum ada Funding Officer aktif.</div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 p-4 bg-background border-t safe-area-bottom">
        <Button className="w-full">Simpan Target</Button>
      </div>
      <div className="h-20" />
    </div>
  );
}
