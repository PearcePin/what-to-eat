import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// GET: 取得使用者的所有收藏
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const user_email = searchParams.get("email");

  if (!user_email) return NextResponse.json({ success: false, error: "Missing email" }, { status: 400 });

  try {
    const favorites = await prisma.favorite.findMany({
      where: { user_email },
      include: { place: true },
    });
    return NextResponse.json({ success: true, favorites });
  } catch (error) {
    console.error("Fetch favorites error:", error);
    return NextResponse.json({ success: false, error: "Internal Server Error" }, { status: 500 });
  }
}

// POST: 新增或移除收藏
export async function POST(request: Request) {
  try {
    const { user_email, place_id, action, name, address, lat, lng, photo_ref } = await request.json();

    if (!user_email || !place_id) {
      return NextResponse.json({ success: false, error: "Missing required fields" }, { status: 400 });
    }

    if (action === "add") {
      // 確保使用者存在，以避免 Foreign Key 錯誤
      await prisma.user.upsert({
        where: { email: user_email },
        update: {},
        create: { email: user_email },
      });

      // 確保 PlaceInfo 存在並更新快照資訊
      await prisma.placeInfo.upsert({
        where: { place_id },
        update: { name, address, lat, lng, photo_ref },
        create: { place_id, name, address, lat, lng, photo_ref },
      });

      await prisma.favorite.upsert({
        where: { user_email_place_id: { user_email, place_id } },
        update: {},
        create: { user_email, place_id },
      });
    } else if (action === "remove") {
      await prisma.favorite.deleteMany({
        where: { user_email, place_id },
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Update favorite error:", error);
    return NextResponse.json({ success: false, error: "Internal Server Error" }, { status: 500 });
  }
}
