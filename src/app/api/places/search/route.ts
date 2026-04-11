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

  // 搜尋關鍵字：直接用餐次 + 類型（不再額外加「店」）
  const textQuery = [meal, type].filter(Boolean).join(" ") || "餐廳";

  const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "Missing API Key" }, { status: 500 });

  try {
    const url = "https://places.googleapis.com/v1/places:searchText";
    const headers = {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "nextPageToken,places.id,places.displayName,places.formattedAddress,places.rating,places.priceLevel,places.priceRange,places.regularOpeningHours,places.photos,places.location"
    };

    const fetchPages = async (useRestriction: boolean): Promise<any[]> => {
      let allPlaces: any[] = [];
      let pageToken: string | null = null;
      let pagesFetched = 0;
      const MAX_PAGES = 5;

      do {
        const body: any = {
          textQuery,
          languageCode: "zh-TW",
          maxResultCount: 20
        };

        if (useRestriction) {
          // 策略 A：強制邊界（最精準，Google 只回傳範圍內）
          body.locationRestriction = { circle: { center: { latitude: lat, longitude: lng }, radius } };
        } else {
          // 策略 B：偏好範圍（較寬鬆，但搭配自己的 Haversine 過濾）
          body.locationBias = { circle: { center: { latitude: lat, longitude: lng }, radius: radius * 1.5 } };
        }

        if (pageToken) body.pageToken = pageToken;

        const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
        const data = await res.json();

        if (data.places) allPlaces = allPlaces.concat(data.places);
        pageToken = data.nextPageToken || null;
        pagesFetched++;
      } while (pageToken && pagesFetched < MAX_PAGES);

      return allPlaces;
    };

    // 策略 A：先用 locationRestriction 嘗試抓精確範圍
    let allPlaces = await fetchPages(true);

    // 策略 B：若結果小於 3 筆，改用 locationBias 補足（較寬鬆但搭配 Haversine 過濾）
    if (allPlaces.length < 3) {
      const biasPlaces = await fetchPages(false);
      // 在這裡用 Haversine 嚴格過濾，只保留範圍內的
      const strictInRadius = biasPlaces.filter(p => {
        const pLat = p.location?.latitude;
        const pLng = p.location?.longitude;
        if (!pLat || !pLng) return false;
        return haversineDistance(lat, lng, pLat, pLng) <= radius;
      });
      allPlaces = strictInRadius.length > 0 ? strictInRadius : biasPlaces; // 若還是沒有就全部保留
    }

    if (allPlaces.length === 0) {
      return NextResponse.json({ success: true, deck: [] });
    }

    // 去重
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

    // 組裝牌庫
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
      const distMeters = (pLat && pLng) ? haversineDistance(lat, lng, pLat, pLng) : null;

      return {
        id: place.id,
        name: place.displayName?.text || "未命名餐廳",
        address: place.formattedAddress || "",
        rating: place.rating || null,
        openNow,
        displayHours: overrideData?.hours || todayHours || null,
        isCommunityRecommended: overrideMap.has(place.id) && (overrideMap.get(place.id)!.avg_user_rating > 0),
        isCommunityHours: !!overrideData?.hours,
        distance: distMeters,
        distanceText: distMeters !== null ? formatDistance(distMeters) : null,
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

      deck = deck.filter(p => p.priceLevel !== null && p.priceLevel >= minL && p.priceLevel <= maxL);
    }

    // 把牌庫隨機洗牌（營業中的排前面），回傳整副牌
    const openPriority = (p: any) => p.openNow === true ? 0 : p.openNow === null ? 1 : 2;
    deck.sort((a, b) => {
      const op = openPriority(a) - openPriority(b);
      if (op !== 0) return op;
      return Math.random() - 0.5; // 同組內完全隨機
    });

    return NextResponse.json({
      success: true,
      deck, // 整副牌，前端自己決定要抽幾張
    });

  } catch (error: any) {
    console.error("Search API Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
