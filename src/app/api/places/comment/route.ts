import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const placeId = searchParams.get("placeId");

  if (!placeId) {
    return NextResponse.json({ error: "Missing placeId" }, { status: 400 });
  }

  try {
    const comments = await prisma.placeComment.findMany({
      where: { place_id: placeId },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ success: true, comments });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { placeId, text, imageUrl, userName, userPhoto, userEmail } = body;

    if (!placeId || !text) {
      return NextResponse.json({ error: "Missing placeId or text" }, { status: 400 });
    }

    // 確保 PlaceInfo 存在 (Prisma 不會自動建立)
    await prisma.placeInfo.upsert({
      where: { place_id: placeId },
      update: {},
      create: {
        place_id: placeId,
        updatedAt: new Date(),
      },
    });

    const comment = await prisma.placeComment.create({
      data: {
        place_id: placeId,
        text,
        imageUrl,
        userName,
        userPhoto,
        userEmail,
      },
    });

    return NextResponse.json({ success: true, comment });
  } catch (error: any) {
    console.error("Comment API Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
