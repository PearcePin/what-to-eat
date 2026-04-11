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
    const url = "https://places.googleapis.com/v1/places:searchText";
    const headers = {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "nextPageToken,places.id,places.displayName,places.formattedAddress,places.rating,places.priceLevel,places.priceRange,places.regularOpeningHours,places.photos,places.location,places.types"
    };

    let allGooglePlaces: any[] = [];
    let currentToken: string | null = pageToken;
    let pagesFetched = 0;
    const MAX_PAGES = 3; // 連續抓取 3 頁，建構 60 家店的大池子

    // --- 連續抓取大池子邏輯 ---
    do {
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
      if (currentToken) body.pageToken = currentToken;

      const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
      const data = await res.json();
      
      if (data.places) allGooglePlaces = allGooglePlaces.concat(data.places);
      currentToken = data.nextPageToken || null;
      pagesFetched++;

      // 如果已經抓夠 60 筆、或者沒下頁了、或者這是分頁請求(只抓一頁新的)，就跳出
    } while (currentToken && pagesFetched < MAX_PAGES && !pageToken);

    if (allGooglePlaces.length === 0) {
      return NextResponse.json({ success: true, results: [] });
    }

    // 2. 查詢社群推薦標記
    const placeIds = allGooglePlaces.map((p: any) => p.id);
    const overrides = await prisma.placeInfo.findMany({ where: { place_id: { in: placeIds } } });
    const overrideMap = new Map(overrides.map(o => [o.place_id, o]));

    // 3. 組裝結果
    let recommendations = allGooglePlaces.map((place: any) => {
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

    // 4. 過濾與排序 (在地化優化：距離加權與營業時間顯示)
    // 即使超過半徑也暫時保留一些候選，但權重降低
    const openPriority = (p: any) => p.openNow === true ? 0 : p.openNow === null ? 1 : 2;
    
    recommendations.sort((a, b) => {
      // 第一優先：營業中 > 未知 > 已歇業
      const op = openPriority(a) - openPriority(b);
      if (op !== 0) return op;

      // 第二優先：距離權重 (Proximity Boost)
      // 離使用者越近得分越高。 500m 內加 3 分, 1km 內加 1.5 分
      const boostA = a.distance < 1000 ? (1000 - a.distance) / 333 : 0;
      const boostB = b.distance < 1000 ? (1000 - b.distance) / 333 : 0;

      // 最終分數 = Google 評分 + 距離加成 + 小幅隨機擾動
      const scoreA = a.finalScore + boostA + (Math.random() * 0.4 - 0.2);
      const scoreB = b.finalScore + boostB + (Math.random() * 0.4 - 0.2);
      return scoreB - scoreA;
    });

    // 最後才切距離
    let filteredResults = recommendations.filter((p: any) => {
       // 如果是步行(1km)，給予 1.3km 的緩衝；其他給予 1.2 倍緩衝
       const buffer = radius <= 1000 ? 1.3 : 1.2;
       return p.distance <= radius * buffer;
    });

    // 5. 預算過濾 (Restore missing logic)
    if (budget && !budget.includes("今天不談錢的事")) {
      let minL = 1, maxL = 4;
      if (budget.includes("100元以下")) { minL = 1; maxL = 1; }
      else if (budget.includes("100–300")) { minL = 1; maxL = 2; }
      else if (budget.includes("300–600")) { minL = 2; maxL = 3; }
      else if (budget.includes("600元以上")) { minL = 3; maxL = 4; }

      filteredResults = filteredResults.filter((p: any) => {
        if (!p.priceLevel) return false;
        return p.priceLevel >= minL && p.priceLevel <= maxL;
      });
    }

    return NextResponse.json({
      success: true,
      results: filteredResults.slice(0, 10),
      nextPageToken: currentToken,
    });

  } catch (error: any) {
    console.error("New Search API Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
