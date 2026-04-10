import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { placeId, rating, overridePrice, overrideHours } = body;

    if (!placeId || !rating || rating < 1 || rating > 5) {
      return NextResponse.json({ error: "缺少必要參數或評分不合法" }, { status: 400 });
    }

    // 1. 寫入 UserReview 紀錄
    await prisma.userReview.create({
      data: {
        place_id: placeId,
        rating: parseFloat(rating),
        override_price: overridePrice || null,
        override_hours: overrideHours || null,
      },
    });

    // 2. 重新計算該地點的平均評分並 upsert PlaceInfo
    const reviews = await prisma.userReview.findMany({
      where: { place_id: placeId },
      select: { rating: true },
    });

    const avgRating =
      reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;

    await prisma.placeInfo.upsert({
      where: { place_id: placeId },
      create: {
        place_id: placeId,
        avg_user_rating: parseFloat(avgRating.toFixed(2)),
        rating_count: reviews.length,
        override_price: overridePrice ?? null,
        override_hours: overrideHours ?? null,
      },
      update: {
        avg_user_rating: parseFloat(avgRating.toFixed(2)),
        rating_count: reviews.length,
        ...(overridePrice !== null && overridePrice !== undefined ? { override_price: overridePrice } : {}),
        ...(overrideHours ? { override_hours: overrideHours } : {}),
      },
    });

    return NextResponse.json({ success: true, avgRating: avgRating.toFixed(2) });
  } catch (error: any) {
    console.error("Feedback API Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
