"use client";

import { useState } from "react";

export function DashboardScreen() {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b p-4">
        <h1 className="text-20 font-600 mb-2">Dashboard</h1>
        <label className="block text-14 font-500 mb-2">Bulan</label>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-full p-2 border rounded" />
      </div>

      {/* Content sections */}
      <div className="p-4 space-y-6">
        {/* Target vs Actual */}
        <section>
          <h2 className="text-16 font-500 mb-3">Target vs Realisasi</h2>
          <div className="text-center py-8 text-muted-foreground text-14">Target belum diatur</div>
        </section>

        {/* Terlambat */}
        <section>
          <h2 className="text-16 font-500 mb-3">Terlambat</h2>
          <div className="text-center py-8 text-muted-foreground text-14">Tidak ada yang terlambat</div>
        </section>

        {/* Kegiatan hari ini dan minggu ini */}
        <section>
          <h2 className="text-16 font-500 mb-3">Kegiatan hari ini dan minggu ini</h2>
          <div className="text-center py-8 text-muted-foreground text-14">Tidak ada Kegiatan</div>
        </section>

        {/* Pipeline per tahap */}
        <section>
          <h2 className="text-16 font-500 mb-3">Pipeline per tahap</h2>
          <div className="text-center py-8 text-muted-foreground text-14">Tidak ada Pipeline</div>
        </section>
      </div>
    </div>
  );
}
