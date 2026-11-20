"use client";

import { useState } from "react";
import type { ActivityRecord } from "@/server/activities";
import { Button } from "@/components/ui/button";
import { Camera } from "lucide-react";

export function CheckInForm({ activity }: { activity: ActivityRecord }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [gps, setGps] = useState<{ lat: number; lon: number; accuracy: number } | null>(null);
  const [loading, setLoading] = useState(false);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) {
      setFile(f);
      const url = URL.createObjectURL(f);
      setPreview(url);
    }
  };

  const handleGetGPS = async () => {
    setLoading(true);
    try {
      const position = await new Promise<GeolocationCoordinates>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition((pos) => resolve(pos.coords), reject, { timeout: 15000 });
      });
      setGps({ lat: position.latitude, lon: position.longitude, accuracy: position.accuracy });
    } catch (error) {
      console.error("GPS error:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (!file) return;
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("activityId", activity.id);
      if (gps) {
        formData.append("lat", String(gps.lat));
        formData.append("lon", String(gps.lon));
        formData.append("accuracy", String(gps.accuracy));
      }

      const res = await fetch("/api/checkins", { method: "POST", body: formData });
      if (res.ok) {
        // Success
        const result = await res.json();
        console.log("Check-in saved:", result);
      } else {
        console.error("Check-in failed:", res.status);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background p-4">
      <h1 className="text-20 font-600 mb-2">Check-in</h1>
      <p className="text-14 text-muted-foreground mb-6">{activity.prospect.name}</p>

      {/* Photo section */}
      <div className="mb-6 border-2 border-dashed rounded-lg p-8 text-center">
        {preview ? (
          <img src={preview} alt="Preview" className="w-full h-auto rounded" />
        ) : (
          <label className="cursor-pointer flex flex-col items-center gap-2">
            <Camera className="w-8 h-8 text-muted-foreground" />
            <span className="text-14 font-500">Ambil atau pilih foto</span>
            <input type="file" accept="image/*" onChange={handleFileSelect} className="hidden" />
          </label>
        )}
      </div>

      {/* GPS section */}
      <div className="mb-6">
        <div className="text-14 font-500 mb-2">Lokasi GPS</div>
        {gps ? (
          <div className="text-14 text-muted-foreground">
            <p>Lat: {gps.lat.toFixed(6)}</p>
            <p>Lon: {gps.lon.toFixed(6)}</p>
            <p>Akurasi: {Math.round(gps.accuracy)} m</p>
          </div>
        ) : (
          <Button variant="outline" onClick={handleGetGPS} disabled={loading}>
            Dapatkan Lokasi GPS
          </Button>
        )}
      </div>

      {/* Actions */}
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-background border-t safe-area-bottom flex gap-2">
        <Button variant="outline" disabled={loading}>
          Batal
        </Button>
        <Button onClick={handleSubmit} disabled={!file || loading}>
          Simpan Check-in
        </Button>
      </div>
      <div className="h-20" />
    </div>
  );
}
