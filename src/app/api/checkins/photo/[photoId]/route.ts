import { requireAdmin } from "@/server/auth";
import { toErrorResponse, notFound } from "@/server/http";
import { getDb } from "@/server/db";
import { checkin } from "@/db/schema";
import { eq } from "drizzle-orm";
import { get } from "@vercel/blob";

/**
 * GET /api/checkins/photo/[photoId]
 *
 * Signed-in Admin only. Fetches the photo from Vercel Blob for a Check-in. photoId is the UUID
 * and not guessable from outside. Photo is private and only Admin can fetch (EC38, E4-S3 #7).
 */
export async function GET(request: Request, { params }: { params: Promise<{ photoId: string }> }) {
  try {
    await requireAdmin(request);
    const { photoId } = await params;

    // Verify this photo path exists and belongs to a valid Check-in
    const db = getDb();
    const rows = await db.select().from(checkin).where(eq(checkin.id, photoId));

    if (rows.length === 0) {
      throw notFound();
    }

    const record = rows[0];

    // Fetch photo from private Blob store
    const result = await get(record.photoPath, { access: "private" });

    if (!result) {
      throw notFound();
    }

    // Stream response with proper headers
    return new Response(result.stream, {
      headers: { "Content-Type": result.blob.contentType || "application/octet-stream", "Cache-Control": "private, max-age=31536000" },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
