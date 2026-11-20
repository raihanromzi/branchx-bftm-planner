import { requireAdmin } from "@/server/auth";
import { assertSameOrigin, toErrorResponse, ApiError } from "@/server/http";
import { saveCheckin } from "@/server/checkins";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * POST /api/checkins
 *
 * Accepts multipart/form-data with file, lat, lon, accuracy. Uploads photo to Vercel Blob,
 * determines On-site/Off-site based on GPS distance, saves Check-in, marks Activity Done.
 * Returns { onSite, distanceM, gpsReason, photoUrl } (EC38, EC33, EC34, EC35, EC37).
 */
export async function POST(request: Request) {
  try {
    await requireAdmin(request);
    assertSameOrigin(request);

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const activityId = formData.get("activityId") as string | null;
    const lat = formData.get("lat") ? parseFloat(formData.get("lat") as string) : undefined;
    const lon = formData.get("lon") ? parseFloat(formData.get("lon") as string) : undefined;
    const accuracy = formData.get("accuracy")
      ? parseFloat(formData.get("accuracy") as string)
      : undefined;

    if (!file) throw new ApiError(400, "validation", "Periksa kembali isian yang ditandai.", { file: "File wajib ada." });
    if (!activityId) throw new ApiError(400, "validation", "Periksa kembali isian yang ditandai.", { activityId: "Kegiatan wajib ada." });
    if (lat !== undefined && isNaN(lat)) {
      throw new ApiError(400, "validation", "Periksa kembali isian yang ditandai.", { lat: "Koordinat tidak valid." });
    }
    if (lon !== undefined && isNaN(lon)) {
      throw new ApiError(400, "validation", "Periksa kembali isian yang ditandai.", { lon: "Koordinat tidak valid." });
    }

    const result = await saveCheckin({ activityId, file, lat, lon, accuracy });
    return Response.json(result, { status: 201, headers: NO_STORE });
  } catch (error) {
    return toErrorResponse(error);
  }
}
