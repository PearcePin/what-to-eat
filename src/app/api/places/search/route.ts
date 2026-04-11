import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Haversine 公式：計算兩點之間的距離（單位：公尺）
function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000; // 地球半徑（公尺）
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// 距離格式化：500m 以下顯示公尺，以上顯示公里
function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} 公尺`;
  return `${(meters / 1000).toFixed(1)} 公里`;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type") || "餐廳";
  const radius = parseFloat(searchParams.get("radius") || "1000");
  const lat = parseFloat(searchParams.get("lat") || "25.033964");
  const lng = parseFloat(searchParams.get("lng") || "121.564468");
  const budget = searchParams.get("budget");

  const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Missing Google Maps API Key" }, { status: 500 });
  }

  const pageToken = searchParams.get("pagetoken");

  try {
    // 1. 使用 Google Places API (New) - Search Text
    const url = "https://places.googleapis.com/v1/places:searchText";
    
    const body: any = {
      textQuery: type,
      locationBias: {
        circle: {
          center: { latitude: lat, longitude: lng },
          radius: radius
        }
      },
      languageCode: "zh-TW",
      maxResultCount: 20 // Google API (New) 單次請求上限為 20
    };

    if (pageToken) {
      body.pageToken = pageToken;
    }

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "nextPageToken,places.id,places.displayName,places.formattedAddress,places.rating,places.priceLevel,places.priceRange,places.regularOpeningHours,places.photos,places.location,places.types"
      },
      body: JSON.stringify(body)
    });

    const data = await res.json();

    if (!data.places) {
      return NextResponse.json({ success: true, results: [] });
    }

    // 2. 查詢社群推薦標記 (僅用於顯示，不影響排名)
    const placeIds = data.places.map((p: any) => p.id);
    const overrides = await prisma.placeInfo.findMany({ where: { place_id: { in: placeIds } } });
    const overrideMap = new Map(overrides.map(o => [o.place_id, o]));

    // 3. 組裝結果
    let recommendations = data.places.map((place: any) => {
      const gRating = place.rating || 0;
      const isCommunityRecommended = overrideMap.has(place.id) && (overrideMap.get(place.id)!.avg_user_rating > 0);
      const overrideData = overrideMap.get(place.id) ? { price: overrideMap.get(place.id)!.override_price, hours: overrideMap.get(place.id)!.override_hours } : null;

      // 新版 API 的營業時間
      const openNow = place.regularOpeningHours?.openNow ?? null;
      const todayHours = place.regularOpeningHours?.weekdayDescriptions?.[new Date().getDay() === 0 ? 6 : new Date().getDay() - 1] ?? null;

      // 社群修正時間優先
      const displayHours: string | null = overrideData?.hours || todayHours;

      // 計算距離
      const pLat = place.location?.latitude;
      const pLng = place.location?.longitude;
      const distMeters = (pLat && pLng) ? haversineDistance(lat, lng, pLat, pLng) : null;

      return {
        id: place.id,
        name: place.displayName?.text || "未命名餐廳",
        address: place.formattedAddress || "",
        rating: place.rating,
        finalScore: gRating, // 完全回歸至 Google Rating
        isCommunityRecommended,
        openNow,
        displayHours,
        isCommunityHours: !!overrideData?.hours,
        distance: distMeters,
        distanceText: distMeters ? formatDistance(distMeters) : null,
        // 新版照片 API 的格式是 projects/.../photos/...
        photoRef: place.photos?.[0]?.name ?? null,
        priceLevel: place.priceLevel === "PRICE_LEVEL_FREE" ? 0 : 
                   place.priceLevel === "PRICE_LEVEL_INEXPENSIVE" ? 1 :
                   place.priceLevel === "PRICE_LEVEL_MODERATE" ? 2 :
                   place.priceLevel === "PRICE_LEVEL_EXPENSIVE" ? 3 :
                   place.priceLevel === "PRICE_LEVEL_VERY_EXPENSIVE" ? 4 : null,
        priceRange: place.priceRange || null,
        overrideData,
      };
    });

    // 嚴格過濾距離 (解決 Google API locationBias 可能跑太遠的問題)
    recommendations = recommendations.filter((p: any) => {
      // 如果無法計算距離，暫且保留，但如果有距離就必須在範圍內
      if (p.distance === null) return true;
      // 緩衝區設為 radius 的 1.1 倍，避免邊緣判定過嚴
      return p.distance <= radius * 1.1;
    });

    // 4. 預算過濾
    if (budget && !budget.includes("今天不談錢的事")) {
      let minL = 1, maxL = 4;
      if (budget.includes("100元以下")) { minL = 1; maxL = 1; }
      else if (budget.includes("100–300")) { minL = 1; maxL = 2; }
      else if (budget.includes("300–600")) { minL = 2; maxL = 3; }
      else if (budget.includes("600元以上")) { minL = 3; maxL = 4; }

      recommendations = recommendations.filter((p: any) => {
        if (!p.priceLevel) return false;
        return p.priceLevel >= minL && p.priceLevel <= maxL;
      });
    }

    // 5. 隨機化與排序邏輯 (Variety 核心)
    // 依營業狀態分組，同組內完全隨機混合高品質名單
    const openPriority = (p: any) => p.openNow === true ? 0 : p.openNow === null ? 1 : 2;
    
    recommendations.sort((a: any, b: any) => {
      const op = openPriority(a) - openPriority(b);
      if (op !== 0) return op;

      // 在同一個營業狀態下，給予較大的隨機擾動，實現「換一批要盡量不一樣」
      // 擾動值放大為 ±1.5，讓 3.5 分的店也有機會隨機贏過 4.5 分的店出現在首頁
      const randomA = a.finalScore + (Math.random() * 3.0 - 1.5);
      const randomB = b.finalScore + (Math.random() * 3.0 - 1.5);
      return randomB - randomA;
    });

    // 從 60 家候選中隨機打亂並取前 10
    // 這保證了即便在第一頁，每次點頭像或搜尋都能看到不同的組合
    return NextResponse.json({
      success: true,
      results: recommendations.slice(0, 10),
      nextPageToken: data.nextPageToken || null,
    });

  } catch (error: any) {
    console.error("New Search API Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
