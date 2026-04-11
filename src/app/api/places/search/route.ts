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

// 取得今天星期對應的 weekday_text 索引（Google 的 weekday_text 從週一開始）
function getTodayHoursText(weekdayText: string[]): string | null {
  const jsDay = new Date().getDay(); // 0=Sunday, 1=Monday, ...
  const idx = jsDay === 0 ? 6 : jsDay - 1; // 轉換為 0=Monday...6=Sunday
  return weekdayText?.[idx] ?? null;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type") || "餐廳";
  const radius = searchParams.get("radius") || "1000";
  const lat = searchParams.get("lat") || "25.033964";
  const lng = searchParams.get("lng") || "121.564468";

  const pageToken = searchParams.get("pagetoken");

  const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Missing Google Maps API Key" }, { status: 500 });
  }

  try {
    // 1. 附近搜尋
    const placesUrl = pageToken 
      ? `https://maps.googleapis.com/maps/api/place/nearbysearch/json?pagetoken=${pageToken}&key=${apiKey}`
      : `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=${radius}&keyword=${encodeURIComponent(type)}&key=${apiKey}`;
    const res = await fetch(placesUrl);
    const data = await res.json();

    if (data.status !== "OK") {
      return NextResponse.json({ error: data.error_message || data.status }, { status: 500 });
    }

    // 2. 平行取得每家店的 Place Details（取得今日完整營業時間）
    const detailsFetches = (data.results as any[]).map(async (place: any) => {
      try {
        const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${place.place_id}&fields=opening_hours,price_level&language=zh-TW&key=${apiKey}`;
        const r = await fetch(url);
        const d = await r.json();
        return { placeId: place.place_id, details: d.result ?? null };
      } catch {
        return { placeId: place.place_id, details: null };
      }
    });
    const detailsResults = await Promise.all(detailsFetches);
    const detailsMap = new Map(detailsResults.map(d => [d.placeId, d.details]));

    // 3. 查詢社群覆寫資料
    const placeIds = (data.results as any[]).map((p: any) => p.place_id);
    const overrides = await prisma.placeInfo.findMany({ where: { place_id: { in: placeIds } } });
    const overrideMap = new Map(overrides.map(o => [o.place_id, o]));

    // 4. 組裝結果
    let recommendations = (data.results as any[]).map((place: any) => {
      const gRating = place.rating || 0;
      let finalScore = gRating;
      let isCommunityRecommended = false;
      let overrideData: any = null;

      if (overrideMap.has(place.place_id)) {
        const uData = overrideMap.get(place.place_id)!;
        const uRating = uData.avg_user_rating || 0;
        if (uRating > 0) {
          finalScore = gRating * 0.5 + uRating * 0.5;
          isCommunityRecommended = true;
        }
        overrideData = { price: uData.override_price, hours: uData.override_hours };
      }

      // Place Details 資料
      const details = detailsMap.get(place.place_id);
      const openHours = details?.opening_hours;
      const openNow: boolean | null = openHours?.open_now ?? place.opening_hours?.open_now ?? null;

      // 今日營業時間文字（例："星期三：上午10:00 – 下午11:00"）
      const todayText: string | null = openHours?.weekday_text
        ? getTodayHoursText(openHours.weekday_text)
        : null;

      // 社群修正時間優先顯示
      const displayHours: string | null = overrideData?.hours || todayText;

      // 計算與使用者的距離
      const placeLat = place.geometry?.location?.lat;
      const placeLng = place.geometry?.location?.lng;
      const distanceMeters =
        placeLat != null && placeLng != null
          ? haversineDistance(parseFloat(lat), parseFloat(lng), placeLat, placeLng)
          : null;
      const distanceText = distanceMeters != null ? formatDistance(distanceMeters) : null;

      return {
        id: place.place_id,
        name: place.name,
        address: place.vicinity,
        rating: place.rating,
        userRating: overrideMap.has(place.place_id) ? overrideMap.get(place.place_id)!.avg_user_rating : null,
        finalScore: parseFloat(finalScore.toFixed(1)),
        isCommunityRecommended,
        openNow,
        todayText,
        displayHours,
        isCommunityHours: !!overrideData?.hours,
        distance: distanceMeters,
        distanceText,
        photoRef: place.photos?.[0]?.photo_reference ?? null,
        overrideData,
        priceLevel: details?.price_level ?? place.price_level ?? null,
      };
    });

    // 預算過濾 (保留沒有 price_level 的餐廳，避免漏掉小吃店)
    const budget = searchParams.get("budget");
    if (budget && !budget.includes("今天不談錢的事")) {
      let minAllowed = 0;
      let maxAllowed = 4;
      if (budget.includes("100元以下")) { minAllowed = 1; maxAllowed = 1; }
      else if (budget.includes("100–300")) { minAllowed = 1; maxAllowed = 2; }
      else if (budget.includes("300–600")) { minAllowed = 2; maxAllowed = 3; }
      else if (budget.includes("600元以上")) { minAllowed = 3; maxAllowed = 4; }

      recommendations = recommendations.filter((p) => {
        if (p.priceLevel === null) return false; // 使用者明確說沒有標價的不要
        return p.priceLevel >= minAllowed && p.priceLevel <= maxAllowed;
      });
    }

    // 5. 排序：開業中 > 無資料 > 已打烊，同狀態內依 finalScore (加入隨機擾動)
    const openPriority = (a: any) =>
      a.openNow === true ? 0 : a.openNow === null ? 1 : 2;
    recommendations.sort((a, b) => {
      const diff = openPriority(a) - openPriority(b);
      if (diff !== 0) return diff;
      
      // 給予 ±0.6 的隨機擾動值，讓每次搜尋結果有一點隨機性，但好店依然容易在上面
      const scoreA = a.finalScore + (Math.random() * 1.2 - 0.6);
      const scoreB = b.finalScore + (Math.random() * 1.2 - 0.6);
      return scoreB - scoreA;
    });

    return NextResponse.json({
      success: true,
      results: recommendations.slice(0, 10),
      nextPageToken: data.next_page_token || null,
    });

  } catch (error: any) {
    console.error("Search API Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
