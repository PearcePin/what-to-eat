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

  const clean = (str: string) =>
    str.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E6}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, "").trim();

  const meal = clean(rawMeal);
  const type = clean(rawType);

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
    const headers = {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      // 升級 FieldMask: 加入 places.types 用於精準過濾
      "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.rating,places.priceLevel,places.priceRange,places.regularOpeningHours,places.photos,places.location,places.types"
    };

    const offset = (radius / 111320) * 0.5;
    const lngOffset = offset / Math.cos(lat * Math.PI / 180);
    const locations = [
      { latitude: lat, longitude: lng },
      { latitude: lat + offset, longitude: lng },
      { latitude: lat - offset, longitude: lng },
      { latitude: lat, longitude: lng + lngOffset },
      { latitude: lat, longitude: lng - lngOffset },
    ];

    const fetchText = async (loc: any) => {
      const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
        method: "POST", headers, body: JSON.stringify({
          textQuery,
          locationBias: { circle: { center: loc, radius: radius * 0.6 } },
          languageCode: "zh-TW",
          maxResultCount: 20
        })
      });
      const data = await res.json();
      return data.places || [];
    };

    const fetchNearby = async (loc: any) => {
      // 動態針對餐期選擇最精確的類型標籤 (Google 官方 Table A)
      let includedTypes = ["restaurant"];
      if (meal === "早餐") {
        includedTypes = ["breakfast_restaurant", "brunch_restaurant", "bakery", "sandwich_shop", "cafe"];
      } else if (meal === "點心") {
        includedTypes = ["dessert_shop", "ice_cream_shop", "bakery", "cafe", "tea_house"];
      } else if (meal === "消夜") {
        includedTypes = ["bar", "night_club", "restaurant"];
      }
      
      const res = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
        method: "POST", headers, body: JSON.stringify({
          includedTypes,
          locationRestriction: { circle: { center: loc, radius: radius * 0.6 } },
          maxResultCount: 20
        })
      });
      const data = await res.json();
      return data.places || [];
    };

    const resultsArray = await Promise.all([
      ...locations.map(loc => fetchText(loc)),
      ...locations.map(loc => fetchNearby(loc))
    ]);
    let allPlaces = resultsArray.flat();

    if (allPlaces.length === 0) return NextResponse.json({ success: true, deck: [] });

    const seen = new Set<string>();
    allPlaces = allPlaces.filter(p => {
      if (!p.id || seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    });

    const placeIds = allPlaces.map(p => p.id);
    const overrides = await prisma.placeInfo.findMany({ where: { place_id: { in: placeIds } } });
    const overrideMap = new Map(overrides.map(o => [o.place_id, o]));

    // ==========================================
    // 建立精準權重映射邏輯 (Relevance Engine)
    // ==========================================
    const mealRelevantTypes: Record<string, string[]> = {
      "早餐": ["breakfast_restaurant", "brunch_restaurant", "bakery", "sandwich_shop", "cafe", "coffee_shop"],
      "點心": ["dessert_shop", "ice_cream_shop", "bakery", "cafe", "tea_house", "candy_store"],
      "消夜": ["bar", "night_club", "liquor_store", "restaurant"],
      "午餐": ["restaurant", "chinese_restaurant", "japanese_restaurant", "italian_restaurant"],
      "晚餐": ["restaurant", "chinese_restaurant", "japanese_restaurant", "italian_restaurant"]
    };

    let deck = allPlaces.map((place: any) => {
      const overrideData = overrideMap.get(place.id)
        ? { price: overrideMap.get(place.id)!.override_price, hours: overrideMap.get(place.id)!.override_hours }
        : null;

      const pLat = place.location?.latitude;
      const pLng = place.location?.longitude;
      const dist = (pLat && pLng) ? haversineDistance(lat, lng, pLat, pLng) : radius * 1.5;

      // 相關性得分計算
      let relevanceScore = 0;
      const pTypes = place.types || [];
      const pName = (place.displayName?.text || "").toLowerCase();
      
      // 1. 類別標籤比對 (Types Match)
      const targetTypes = mealRelevantTypes[meal] || ["restaurant"];
      if (pTypes.some((t: string) => targetTypes.includes(t))) {
        relevanceScore += 2000; // 官方類別符合
      }
      
      // 2. 名稱關鍵字比對 (Name Match)
      const keywords = [meal, type].filter(Boolean);
      if (keywords.some(k => pName.includes(k.toLowerCase()))) {
        relevanceScore += 1500; // 名稱符合關鍵字
      }

      return {
        id: place.id,
        name: place.displayName?.text || "未命名餐廳",
        address: place.formattedAddress || "",
        rating: place.rating || 0,
        openNow: place.regularOpeningHours?.openNow ?? null,
        displayHours: overrideData?.hours || place.regularOpeningHours?.weekdayDescriptions?.[new Date().getDay() === 0 ? 6 : new Date().getDay() - 1] || null,
        distance: dist,
        distanceText: formatDistance(dist),
        photoRef: place.photos?.[0]?.name ?? null,
        priceLevel: place.priceLevel === "PRICE_LEVEL_FREE" ? 0 : place.priceLevel === "PRICE_LEVEL_INEXPENSIVE" ? 1 : place.priceLevel === "PRICE_LEVEL_MODERATE" ? 2 : place.priceLevel === "PRICE_LEVEL_EXPENSIVE" ? 3 : 4,
        priceRange: place.priceRange || null,
        isCommunityRecommended: overrideMap.has(place.id) && (overrideMap.get(place.id)!.avg_user_rating > 0),
        isCommunityHours: !!overrideData?.hours,
        overrideData,
        relevanceScore, // 用於排序
      };
    });

    deck = deck.filter(p => p.distance <= radius);

    if (budget && !budget.includes("今天不談錢的事")) {
      const minL = budget.includes("100元以下") ? 1 : budget.includes("100–300") ? 1 : budget.includes("300–600") ? 2 : 3;
      const maxL = budget.includes("100元以下") ? 1 : budget.includes("100–300") ? 2 : budget.includes("300–600") ? 3 : 4;
      deck = deck.filter(p => !p.priceLevel || (p.priceLevel >= minL && p.priceLevel <= maxL));
    }

    // ==========================================
    // 精準多維排序 (Multi-dimensional Ranking)
    // ==========================================
    deck.sort((a, b) => {
      // 距離權重：與基礎得分相結合
      const distScore = (d: number) => d < 50 ? 5000 : d < 150 ? 2500 : d < 300 ? 500 : d < 500 ? 200 : 100;
      
      // 總分 = 距離分 + 相關分 + 評分加成 + 隨機微調
      const scoreA = distScore(a.distance) + (a.relevanceScore || 0) + (a.rating || 0) * 10 + (Math.random() * 0.5);
      const scoreB = distScore(b.distance) + (b.relevanceScore || 0) + (b.rating || 0) * 10 + (Math.random() * 0.5);
      
      return scoreB - scoreA;
    });

    return NextResponse.json({ success: true, deck });

  } catch (error: any) {
    console.error("Search API Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
