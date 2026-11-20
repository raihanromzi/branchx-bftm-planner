import "server-only";
import { eq } from "drizzle-orm";
import { put } from "@vercel/blob";
import { getDb, type Db, type Tx } from "@/server/db";
import { activity, checkin, prospect } from "@/db/schema";
import { ApiError, invalidState, notFound } from "@/server/http";

const MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_SIZE = 4 * 1024 * 1024; // 4 MB
const ON_SITE_RADIUS_M = 200;

/** Haversine distance in meters between two (lat, lon) pairs. */
function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000; // Earth radius in meters
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

export interface SaveCheckInInput {
  activityId: string;
  file: File;
  lat?: number;
  lon?: number;
  accuracy?: number;
}

export interface CheckInResult {
  id: string;
  onSite: boolean;
  distanceM: number | null;
  gpsReason: string | null;
}

export async function saveCheckin(input: SaveCheckInInput, { db = getDb() }: { db?: Db } = {}): Promise<CheckInResult> {
  // Fetch Activity and Prospect
  const rows = await db
    .select({ activity: activity, prospect: prospect })
    .from(activity)
    .innerJoin(prospect, eq(activity.prospectId, prospect.id))
    .where(eq(activity.id, input.activityId));

  if (rows.length === 0) throw notFound();

  const { activity: act_, prospect: p } = rows[0];

  // Check Activity is Scheduled (EC27, EC29)
  if (act_.status !== "scheduled") {
    throw invalidState(
      "Kegiatan ini sudah selesai atau dibatalkan.",
      "invalid_state",
    );
  }

  // Check Activity date is not in the future (WIB, EC29)
  const now = new Date();
  const wibOffset = 7; // WIB is UTC+7
  const activityTimeWIB = new Date(act_.startsAt.getTime() + wibOffset * 60 * 60 * 1000);
  if (activityTimeWIB > now) {
    throw invalidState(
      "Belum saatnya mencatat Kegiatan ini.",
      "invalid_state",
    );
  }

  // Validate file: type and size (EC37)
  const buffer = await input.file.arrayBuffer();
  if (buffer.byteLength > MAX_SIZE) {
    throw new ApiError(400, "validation", "Foto maksimal 4 MB.", { file: "Foto maksimal 4 MB." });
  }

  if (!MIME_TYPES.has(input.file.type)) {
    throw new ApiError(
      400,
      "validation",
      "Format foto harus JPEG, PNG, atau WebP.",
      { file: "Format foto harus JPEG, PNG, atau WebP." },
    );
  }

  // Determine on-site/off-site (EC33, EC34, EC35)
  let onSite = false;
  let distanceM: number | null = null;
  let gpsReason: string | null = null;

  if (p.lat !== null && p.lng !== null && input.lat !== undefined && input.lon !== undefined) {
    // Check accuracy (EC33)
    if (input.accuracy !== undefined && input.accuracy > 200) {
      gpsReason = "GPS tidak akurat";
      onSite = false;
    } else {
      distanceM = haversineDistance(p.lat, p.lng, input.lat, input.lon);
      onSite = distanceM <= ON_SITE_RADIUS_M;
      if (!onSite) gpsReason = `Jauh ${Math.round(distanceM)} m`;
    }
  } else if (!p.lat || !p.lng) {
    gpsReason = "Lokasi Prospect tidak ada"; // EC34
  } else {
    gpsReason = "GPS tidak tersedia"; // EC33
  }

  // Upload photo to Vercel Blob (EC38)
  const photoId = crypto.randomUUID();
  const photoBlob = await put(`bftm-planner-checkins/${photoId}`, buffer, {
    contentType: input.file.type,
    access: "private",
  });

  // Save Check-in and mark Activity Done in a transaction
  const result = await db.transaction(async (tx: Tx) => {
    const [checkinRow] = await tx
      .insert(checkin)
      .values({
        activityId: input.activityId,
        photoPath: photoBlob.pathname,
        onSite,
        distanceM,
        gpsReason,
      })
      .returning({ id: checkin.id });

    await tx
      .update(activity)
      .set({ status: "done" })
      .where(eq(activity.id, input.activityId));

    return { id: checkinRow.id, onSite, distanceM, gpsReason };
  });

  return result;
}

export async function getCheckInPhoto(pathname: string, { db = getDb() }: { db?: Db } = {}) {
  // Fetch Check-in by photo path; pathname is the Blob pathname
  const rows = await db.select().from(checkin).where(eq(checkin.photoPath, pathname));

  if (rows.length === 0) throw notFound();

  return rows[0];
}
