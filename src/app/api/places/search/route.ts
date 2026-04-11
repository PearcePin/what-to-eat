import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
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

  // 清理 Emoji
  const clean = (str: string) =>
    str.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E6}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, "").trim();

  const meal = clean(rawMeal); // e.g. "早餐", "午餐", "消夜"
  const type = clean(rawType); // e.g. "火鍋", "日式/壽司"

  // 搜尋關鍵字優化：使用最直接的在地關鍵字
  let textQuery = [meal, type].filter(Boolean).join(" ") || "餐廳";
  if (meal === "早餐") {
    textQuery = `早餐店 ${type}`.trim();
  } else if (meal === "消夜") {
    textQuery = `宵夜 ${type}`.trim();
  } else if (meal === "點心") {
    textQuery = `甜點 咖啡廳 ${type}`.trim();
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "Missing API Key" }, { status: 500 });

  try {
    const url = "https://places.googleapis.com/v1/places:searchText";
    const headers = {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "nextPageToken,places.id,places.displayName,places.formattedAddress,places.rating,places.priceLevel,places.priceRange,places.regularOpeningHours,places.photos,places.location"
    };

    // 擴大搜尋母體：同時發送兩個不同的關鍵字請求，以突破單次搜尋 60 筆的限制
    const queries = [textQuery];
    if (meal === "早餐") queries.push("早午餐");
    else if (meal === "消夜") queries.push("深夜食堂");
    else if (meal !== "餐廳") queries.push(meal);

    const fetchUniquePlaces = async (query: string) => {
      let places: any[] = [];
      let pageToken: string | null = null;
      let pagesFetched = 0;
      const biasRadius = Math.min(radius * 3, 5000);

      do {
        const body: any = {
          textQuery: query,
          locationBias: {
            circle: { center: { latitude: lat, longitude: lng }, radius: biasRadius }
          },
          languageCode: "zh-TW",
          maxResultCount: 20
        };
        if (pageToken) body.pageToken = pageToken;

        const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
        const data = await res.json();
        if (data.places) places = places.concat(data.places);
        pageToken = data.nextPageToken || null;
        pagesFetched++;
      } while (pageToken && pagesFetched < 3);
      return places;
    };

    // 並行執行所有搜尋請求
    const resultsArray = await Promise.all(queries.map(q => fetchUniquePlaces(q)));
    let allPlaces = resultsArray.flat();

    if (allPlaces.length === 0) {
      return NextResponse.json({ success: true, deck: [] });
    }

    // 去重 (重複的 Place ID 只保留一個)
    const seen = new Set<string>();
    allPlaces = allPlaces.filter(p => {
      if (seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    });

    // 查詢社群推薦標記
    const placeIds = allPlaces.map(p => p.id);
    const overrides = await prisma.placeInfo.findMany({ where: { place_id: { in: placeIds } } });
    const overrideMap = new Map(overrides.map(o => [o.place_id, o]));

    // 組裝牌庫並計算精確距離
    let deck = allPlaces.map((place: any) => {
      const overrideData = overrideMap.get(place.id)
        ? { price: overrideMap.get(place.id)!.override_price, hours: overrideMap.get(place.id)!.override_hours }
        : null;

      const openNow = place.regularOpeningHours?.openNow ?? null;
      const todayHours = place.regularOpeningHours?.weekdayDescriptions?.[
        new Date().getDay() === 0 ? 6 : new Date().getDay() - 1
      ] ?? null;

      const pLat = place.location?.latitude;
      const pLng = place.location?.longitude;
      const dist = (pLat && pLng) ? haversineDistance(lat, lng, pLat, pLng) : radius * 3;

      return {
        id: place.id,
        name: place.displayName?.text || "未命名餐廳",
        address: place.formattedAddress || "",
        rating: place.rating || 0,
        openNow,
        displayHours: overrideData?.hours || todayHours || null,
        isCommunityRecommended: overrideMap.has(place.id) && (overrideMap.get(place.id)!.avg_user_rating > 0),
        isCommunityHours: !!overrideData?.hours,
        distance: dist,
        distanceText: formatDistance(dist),
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

    // 嚴格距離與預算過濾
    deck = deck.filter(p => p.distance <= radius);

    if (budget && !budget.includes("今天不談錢的事")) {
      const minL = budget.includes("100元以下") ? 1 : budget.includes("100–300") ? 1 : budget.includes("300–600") ? 2 : 3;
      const maxL = budget.includes("100元以下") ? 1 : budget.includes("100–300") ? 2 : budget.includes("300–600") ? 3 : 4;
      deck = deck.filter(p => !p.priceLevel || (p.priceLevel >= minL && p.priceLevel <= maxL));
    }

    // 距離優先排序
    deck.sort((a, b) => {
      const distScore = (d: number) => d < 100 ? 50 : d < 300 ? 30 : d < 500 ? 20 : d < 1000 ? 10 : 0;
      const openScore = (open: boolean | null) => open === true ? 5 : 0;
      const scoreA = (a.rating || 0) + distScore(a.distance) + openScore(a.openNow) + (Math.random() * 0.5);
      const scoreB = (b.rating || 0) + distScore(b.distance) + openScore(b.openNow) + (Math.random() * 0.5);
      return scoreB - scoreA;
    });

    return NextResponse.json({ success: true, deck });

  } catch (error: any) {
    console.error("Search API Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
