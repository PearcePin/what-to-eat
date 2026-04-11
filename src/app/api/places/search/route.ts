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
  const rawMeal = searchParams.get("meal") || "";
  const rawType = searchParams.get("type") || "";
  const radius = parseFloat(searchParams.get("radius") || "1000");
  const lat = parseFloat(searchParams.get("lat") || "25.033964");
  const lng = parseFloat(searchParams.get("lng") || "121.564468");
  const budget = searchParams.get("budget");

  // 1. 清理關鍵字 (去除表情符號並轉換為優化關鍵字)
  const clean = (str: string) => str.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E6}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '').trim();
  
  const meal = clean(rawMeal);
  const type = clean(rawType);

  // 2. 智慧映射：放寬類別過濾，改用包含性最強的 "restaurant"
  // 並搭配精確關鍵字，避免因為 Google 標註不完全而漏掉在地店面 (特別是早餐店)
  let includedType = "restaurant"; 
  let optimizedMeal = meal;

  if (meal === "早餐") {
    optimizedMeal = "早餐店";
  } else if (meal === "點心") {
    optimizedMeal = "甜點 咖啡廳";
  } else if (meal === "消夜") {
    optimizedMeal = "宵夜";
  }

  const combinedQuery = `${optimizedMeal} ${type}`.trim() || "餐廳";

  const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Missing Google Maps API Key" }, { status: 500 });
  }

  const pageToken = searchParams.get("pagetoken");

  try {
    // 1. 使用 Google Places API (New) - Search Text
    const url = "https://places.googleapis.com/v1/places:searchText";
    
    const body: any = {
      textQuery: combinedQuery,
      includedType: includedType, 
      locationBias: {
        circle: {
          center: { latitude: lat, longitude: lng },
          radius: radius
        }
      },
      languageCode: "zh-TW",
      maxResultCount: 20
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

    // 2. 查詢社群推薦標記
    const placeIds = data.places.map((p: any) => p.id);
    const overrides = await prisma.placeInfo.findMany({ where: { place_id: { in: placeIds } } });
    const overrideMap = new Map(overrides.map(o => [o.place_id, o]));

    // 3. 組裝結果
    let recommendations = data.places.map((place: any) => {
      const gRating = place.rating || 0;
      const isCommunityRecommended = overrideMap.has(place.id) && (overrideMap.get(place.id)!.avg_user_rating > 0);
      const overrideData = overrideMap.get(place.id) ? { price: overrideMap.get(place.id)!.override_price, hours: overrideMap.get(place.id)!.override_hours } : null;

      const openNow = place.regularOpeningHours?.openNow ?? null;
      const todayHours = place.regularOpeningHours?.weekdayDescriptions?.[new Date().getDay() === 0 ? 6 : new Date().getDay() - 1] ?? null;
      const displayHours: string | null = overrideData?.hours || todayHours;

      const pLat = place.location?.latitude;
      const pLng = place.location?.longitude;
      const distMeters = (pLat && pLng) ? haversineDistance(lat, lng, pLat, pLng) : 0;

      return {
        id: place.id,
        name: place.displayName?.text || "未命名餐廳",
        address: place.formattedAddress || "",
        rating: place.rating,
        finalScore: gRating,
        isCommunityRecommended,
        openNow,
        displayHours,
        isCommunityHours: !!overrideData?.hours,
        distance: distMeters,
        distanceText: distMeters ? formatDistance(distMeters) : null,
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

    // 嚴格過濾距離
    recommendations = recommendations.filter((p: any) => p.distance <= radius * 1.1);

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

    // 5. 排序與隨機化 (在地化優化：距離加權)
    const openPriority = (p: any) => p.openNow === true ? 0 : p.openNow === null ? 1 : 2;
    
    recommendations.sort((a, b) => {
      const op = openPriority(a) - openPriority(b);
      if (op !== 0) return op;

      // 距離加權邏輯 (Proximity Boost)
      // 在 300 公尺內的店家，分數補償 +1.5~+2.0 分
      // 這樣可以確保「旁邊的店」即便評分稍低，也會排在最前面
      const boostA = a.distance < 300 ? (300 - a.distance) / 100 : 0;
      const boostB = b.distance < 300 ? (300 - b.distance) / 100 : 0;

      const scoreA = a.finalScore + boostA + (Math.random() * 0.8 - 0.4);
      const scoreB = b.finalScore + boostB + (Math.random() * 0.8 - 0.4);
      return scoreB - scoreA;
    });

    return NextResponse.json({
      success: true,
      results: recommendations.slice(0, 10),
      nextPageToken: data.nextPageToken || null,
    });

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
