import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Haversine 公式：計算兩點之間的距離（單位：公尺）
function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

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

  // 清理關鍵字 (去除表情符號)
  const clean = (str: string) => str.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E6}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '').trim();

  const meal = clean(rawMeal);
  const type = clean(rawType);

  // 關鍵字優化
  let optimizedMeal = meal;
  if (meal === "早餐") optimizedMeal = "早餐店";
  else if (meal === "點心") optimizedMeal = "甜點 咖啡廳";
  else if (meal === "消夜") optimizedMeal = "宵夜";

  const combinedQuery = `${optimizedMeal} ${type}`.trim() || "餐廳";

  const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Missing Google Maps API Key" }, { status: 500 });
  }

  try {
    const url = "https://places.googleapis.com/v1/places:searchText";
    const headers = {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "nextPageToken,places.id,places.displayName,places.formattedAddress,places.rating,places.priceLevel,places.priceRange,places.regularOpeningHours,places.photos,places.location,places.types"
    };

    // ===================================================================
    // 核心邏輯：使用 locationRestriction (強制範圍) 取代 locationBias (推薦)
    // 並自動翻頁，直到把範圍內所有店家通通抓完為止 (上限 5 頁 = 100 家)
    // ===================================================================
    let allGooglePlaces: any[] = [];
    let currentToken: string | null = null;
    let pagesFetched = 0;
    const MAX_PAGES = 5; // 安全上限：最多 100 家，避免無限循環

    do {
      const body: any = {
        textQuery: combinedQuery,
        includedType: "restaurant",
        // 使用 locationRestriction：Google 被強制只回傳這個圓圈範圍內的店家
        // 不再會出現 10 公里外的殭屍推薦
        locationRestriction: {
          circle: {
            center: { latitude: lat, longitude: lng },
            radius: radius
          }
        },
        languageCode: "zh-TW",
        maxResultCount: 20
      };
      if (currentToken) body.pageToken = currentToken;

      const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
      const data = await res.json();

      if (data.places) allGooglePlaces = allGooglePlaces.concat(data.places);
      currentToken = data.nextPageToken || null;
      pagesFetched++;

      // 抓完了或沒有下一頁就停止
    } while (currentToken && pagesFetched < MAX_PAGES);

    if (allGooglePlaces.length === 0) {
      return NextResponse.json({ success: true, results: [], nextPageToken: null });
    }

    // 去重（同一家店可能因翻頁重複出現）
    const seenIds = new Set<string>();
    allGooglePlaces = allGooglePlaces.filter(p => {
      if (seenIds.has(p.id)) return false;
      seenIds.add(p.id);
      return true;
    });

    // 查詢社群推薦標記
    const placeIds = allGooglePlaces.map((p: any) => p.id);
    const overrides = await prisma.placeInfo.findMany({ where: { place_id: { in: placeIds } } });
    const overrideMap = new Map(overrides.map(o => [o.place_id, o]));

    // 組裝結果
    let recommendations = allGooglePlaces.map((place: any) => {
      const gRating = place.rating || 0;
      const isCommunityRecommended = overrideMap.has(place.id) && (overrideMap.get(place.id)!.avg_user_rating > 0);
      const overrideData = overrideMap.get(place.id) ? {
        price: overrideMap.get(place.id)!.override_price,
        hours: overrideMap.get(place.id)!.override_hours
      } : null;

      const openNow = place.regularOpeningHours?.openNow ?? null;
      const todayHours = place.regularOpeningHours?.weekdayDescriptions?.[
        new Date().getDay() === 0 ? 6 : new Date().getDay() - 1
      ] ?? null;
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

    // 預算過濾
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

    // 排序：營業中優先 -> 距離近優先 -> 評分高優先 -> 小幅隨機
    const openPriority = (p: any) => p.openNow === true ? 0 : p.openNow === null ? 1 : 2;

    recommendations.sort((a, b) => {
      const op = openPriority(a) - openPriority(b);
      if (op !== 0) return op;

      // 距離越近加分越多（500m 內最多加 3 分）
      const boostA = Math.max(0, (radius - a.distance) / radius) * 3;
      const boostB = Math.max(0, (radius - b.distance) / radius) * 3;

      const scoreA = a.finalScore + boostA + (Math.random() * 0.6 - 0.3);
      const scoreB = b.finalScore + boostB + (Math.random() * 0.6 - 0.3);
      return scoreB - scoreA;
    });

    // 因為已用 locationRestriction，不再需要二次距離過濾
    // 回傳全部結果（前端一次顯示 10 筆，剩餘的讓「換一批」來消化）
    return NextResponse.json({
      success: true,
      results: recommendations.slice(0, 10),
      // 把整個已排好序的池子也傳回去（含後續的「換一批」候選）
      allResults: recommendations,
      totalFound: recommendations.length,
      nextPageToken: null, // 已全部抓完，不需要 pageToken
    });

  } catch (error: any) {
    console.error("Search API Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
