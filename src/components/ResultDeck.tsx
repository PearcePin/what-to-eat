"use client";

import { useState, useEffect } from "react";
import FeedbackModal from "./FeedbackModal";

interface Location { lat: number; lng: number; label: string; }

// 標籤樣式 helper
const Tag = ({ color, bg, border, children }: any) => (
  <span style={{
    display: "inline-flex", alignItems: "center", gap: "4px",
    background: bg, color, border: `1px solid ${border}`,
    padding: "3px 10px", borderRadius: "20px", fontSize: "0.73rem", fontWeight: 600,
  }}>
    {children}
  </span>
);

export default function ResultDeck({ filters, location, user, isGuest, isFavMode }: { filters: any; location: Location; user: any; isGuest: boolean; isFavMode?: boolean }) {
  const [loading, setLoading] = useState(true);
  const [places, setPlaces] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [isSpinning, setIsSpinning] = useState(false);
  const [selectedPlace, setSelectedPlace] = useState<any>(null);
  const [feedbackPlace, setFeedbackPlace] = useState<any>(null);
  const [userFavorites, setUserFavorites] = useState<string[]>([]); // 儲存 place_id 列表

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

  useEffect(() => {
    if (isFavMode) fetchFavRoulette();
    else fetchPlaces();
    if (user) fetchFavorites();
  }, [filters, isFavMode]);

  const getDistance = (lat1: number, lng1: number, lat2: number, lng2: number) => {
    const R = 6371; // km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  const fetchFavRoulette = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/favorites?email=${user.email}`);
      const data = await res.json();
      if (data.success) {
        // 過濾 10km 內的店
        // 註：placeInfo 需要經緯度，如果當初儲存時沒存，這裡會抓不到。
        // 但目前 PlaceInfo 只有 place_id。我們需要從 Google 補抓經緯度，
        // 或者在搜尋結果時就先把經緯度存進 PlaceInfo。
        // 目前我們先假設 place 結果包含距離資訊 (從 API 吐回來的)
        // 或者是我們在這裡對每一個 Favorites 呼叫一次 Details (效能較差)
        // 更好的做法：搜尋時 PlaceInfo 已經快照了經緯度。

        // 過濾 10km 內的店
        const favs = data.favorites
          .map((f: any) => f.place)
          .filter((p: any) => {
            if (!p.lat || !p.lng) return true; // 如果沒存到經緯度，就假設可以抽
            const dist = getDistance(location.lat, location.lng, p.lat, p.lng);
            return dist <= 10;
          })
          .map((p: any) => ({
            ...p,
            id: p.place_id,
            photoRef: p.photo_ref,
            finalScore: p.avg_user_rating > 0 ? p.avg_user_rating.toFixed(1) : "–",
            distanceText: p.lat ? `${getDistance(location.lat, location.lng, p.lat, p.lng).toFixed(1)} km` : null
          }));

        if (favs.length === 0) {
          setError("10公里內沒有找到您的收藏店家喔！");
        } else {
          setPlaces(favs);
          // 自動開始轉盤
          setTimeout(() => handleRoulette(), 500);
        }
      }
    } catch { setError("讀取收藏失敗"); }
    finally { setLoading(false); }
  };

  const fetchFavorites = async () => {
    try {
      const res = await fetch(`/api/favorites?email=${user.email}`);
      const data = await res.json();
      if (data.success) setUserFavorites(data.favorites.map((f: any) => f.place_id));
    } catch (e) { console.error("Fetch favs error", e); }
  };

  const toggleFavorite = async (place: any) => {
    if (isGuest) {
      alert("請登入後再使用收藏功能！✨");
      return;
    }
    const isFav = userFavorites.includes(place.id);
    const action = isFav ? "remove" : "add";

    // Optimistic UI update
    if (isFav) setUserFavorites(prev => prev.filter(id => id !== place.id));
    else setUserFavorites(prev => [...prev, place.id]);

    try {
      await fetch("/api/favorites", {
        method: "POST",
        body: JSON.stringify({
          user_email: user.email,
          place_id: place.id,
          action,
          name: place.name,
          address: place.address,
          lat: place.location?.lat,
          lng: place.location?.lng,
          photo_ref: place.photoRef
        }),
      });
    } catch (e) {
      console.error("Toggle fav error", e);
      fetchFavorites();
    }
  };

  const fetchPlaces = async () => {
    setLoading(true);
    setSelectedPlace(null);
    let radius = "1000";
    if (filters.transport.includes("腳踏車")) radius = "3000";
    if (filters.transport.includes("汽機車")) radius = "5000";
    try {
      const res = await fetch(
        `/api/places/search?type=${encodeURIComponent(filters.type)}&radius=${radius}&lat=${location.lat}&lng=${location.lng}`
      );
      const data = await res.json();
      if (data.success) { setPlaces(data.results); setError(""); }
      else setError(data.error || "無法載入餐廳資料");
    } catch { setError("連線錯誤"); }
    finally { setLoading(false); }
  };

  const handleRoulette = () => {
    if (!places.length) return;
    setIsSpinning(true);
    setSelectedPlace(null);
    let count = 0;
    const iv = setInterval(() => {
      setSelectedPlace(places[Math.floor(Math.random() * places.length)]);
      if (++count > 20) { clearInterval(iv); setIsSpinning(false); }
    }, 100);
  };

  const getPhotoUrl = (ref: string | null) =>
    ref && apiKey ? `https://maps.googleapis.com/maps/api/place/photo?maxwidth=600&photo_reference=${ref}&key=${apiKey}` : null;

  /* ──── 載入中 ──── */
  if (loading) return (
    <div className="glass-panel" style={{ textAlign: "center", padding: "2.5rem" }}>
      <div style={{ fontSize: "2.5rem", marginBottom: "1rem", animation: "float 2s ease infinite" }}>🍜</div>
      <p style={{ color: "var(--text-secondary)", fontWeight: 600 }}>正在尋找美食中...</p>
      <div style={{ margin: "1.2rem auto 0", width: "32px", height: "32px", border: "3px solid rgba(255,155,176,0.2)", borderTop: "3px solid var(--primary)", borderRadius: "50%", animation: "spin 0.9s linear infinite" }} />
    </div>
  );

  /* ──── 錯誤 ──── */
  if (error) return (
    <div className="glass-panel" style={{ textAlign: "center", padding: "2rem" }}>
      <p style={{ color: "var(--error)", marginBottom: "1rem" }}>😢 {error}</p>
      <button className="btn-secondary" onClick={fetchPlaces}>重試</button>
    </div>
  );

  const displayList = selectedPlace ? [selectedPlace] : places;

  return (
    <div style={{ width: "100%", animation: "fadeIn 0.5s ease" }}>
      {/* Feedback Modal */}
      {feedbackPlace && (
        <FeedbackModal
          place={feedbackPlace}
          apiKey={apiKey}
          onClose={() => setFeedbackPlace(null)}
          onSubmitted={() => { setFeedbackPlace(null); fetchPlaces(); }}
        />
      )}

      {/* 標題列 */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.2rem" }}>
        <h3 style={{ margin: 0, fontSize: "1.1rem", color: "var(--text)" }}>
          🍴 附近推薦
        </h3>
        {!selectedPlace && (
          <button className="btn-secondary" style={{ padding: "6px 16px", fontSize: "0.82rem" }} onClick={fetchPlaces}>
            🔄 換一批
          </button>
        )}
      </div>

      {/* 卡片列表 */}
      <div style={{ display: "flex", flexDirection: "column", gap: "1.2rem" }}>
        {displayList.map((place) => {
          const photoUrl = getPhotoUrl(place.photoRef);
          const isChosen = !isSpinning && selectedPlace?.id === place.id;
          return (
            <div
              key={place.id}
              style={{
                background: "var(--card-bg)",
                backdropFilter: "blur(20px)",
                border: `1.5px solid ${isChosen ? "var(--primary)" : "var(--card-border)"}`,
                borderRadius: "20px",
                overflow: "hidden",
                boxShadow: isChosen
                  ? "0 0 20px rgba(255,155,176,0.35)"
                  : "var(--card-shadow)",
                transition: "all 0.2s ease",
                transform: isSpinning ? "scale(1.02)" : "scale(1)",
              }}
            >
              {/* 照片 */}
              {photoUrl ? (
                <div style={{ width: "100%", height: "180px", overflow: "hidden", position: "relative" }}>
                  <img src={photoUrl} alt={place.name}
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                  />
                  {/* 遮罩 */}
                  <div style={{ position: "absolute", inset: 0, background: "rgba(255,245,248,0.6)", pointerEvents: "none", mixBlendMode: "normal" }} />
                  {/* 分數浮標 */}
                  <div style={{
                    position: "absolute", bottom: "12px", right: "12px",
                    background: "rgba(255,255,255,0.92)", backdropFilter: "blur(8px)",
                    border: "1px solid rgba(255,182,193,0.4)",
                    color: "#E86080", fontWeight: 800,
                    padding: "4px 12px", borderRadius: "20px", fontSize: "0.85rem",
                  }}>
                    ⭐ {place.finalScore}
                  </div>
                  {/* 收藏按鈕 */}
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleFavorite(place); }}
                    style={{
                      position: "absolute", top: "12px", right: "12px",
                      background: "rgba(255,255,255,0.85)", backdropFilter: "blur(8px)",
                      border: "none", width: "36px", height: "36px", borderRadius: "50%",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      cursor: "pointer", fontSize: "1.2rem", transition: "transform 0.2s",
                      boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.transform = "scale(1.1)"}
                    onMouseLeave={(e) => e.currentTarget.style.transform = "scale(1)"}
                  >
                    {userFavorites.includes(place.id) ? "❤️" : "🤍"}
                  </button>
                </div>
              ) : (
                <div style={{
                  width: "100%", height: "90px",
                  background: "#FFE8EF",
                  display: "flex", alignItems: "center", justifyContent: "center", fontSize: "2.5rem",
                }}>
                  🍽️
                </div>
              )}

              {/* 資訊區 */}
              <div style={{ padding: "1rem 1.2rem 1.2rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.25rem" }}>
                  <h3 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 800, color: "var(--text)", flex: 1 }}>{place.name}</h3>
                  {!photoUrl && (
                    <span style={{ color: "#E86080", fontWeight: 800, fontSize: "0.9rem", marginLeft: "8px" }}>⭐ {place.finalScore}</span>
                  )}
                </div>

                <p style={{ margin: "0 0 0.8rem", fontSize: "0.78rem", color: "var(--text-secondary)" }}>
                  📍 {place.address}
                </p>

                {/* 標籤列 */}
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "0.9rem" }}>
                  {place.openNow === true  && <Tag color="#3DAA80" bg="rgba(157,219,192,0.25)" border="rgba(157,219,192,0.6)">🟢 開業中</Tag>}
                  {place.openNow === false && <Tag color="#E07080" bg="rgba(255,182,193,0.25)" border="rgba(255,182,193,0.6)">🔴 已打烊</Tag>}
                  {place.distanceText     && <Tag color="#C07030" bg="rgba(255,210,176,0.3)"  border="rgba(255,210,176,0.7)">🚶 {place.distanceText}</Tag>}
                  <Tag color="var(--text-secondary)" bg="rgba(0,0,0,0.04)" border="rgba(0,0,0,0.08)">Google ⭐ {place.rating ?? "–"}</Tag>
                  {place.isCommunityRecommended && <Tag color="#5A7FD0" bg="rgba(163,204,224,0.25)" border="rgba(163,204,224,0.6)">✦ 社群推薦</Tag>}
                </div>

                {/* 今日營業時間 / 社群修正 / 價位 */}
                {(place.displayHours || place.overrideData?.price) && (
                  <div style={{ marginBottom: "1rem", display: "flex", flexDirection: "column", gap: "3px" }}>
                    {place.overrideData?.price && (
                      <p style={{ margin: 0, fontSize: "0.78rem", color: "#C07030" }}>
                        💰 社群回報：{place.overrideData.price}
                      </p>
                    )}
                    {place.displayHours && (
                      <p style={{ margin: 0, fontSize: "0.78rem", color: place.isCommunityHours ? "var(--secondary-dark)" : "var(--text-secondary)" }}>
                        🕐 {place.isCommunityHours ? "社群修正：" : "今日營業："}
                        {place.displayHours.replace(/^[^：]+：\s*/, "")}
                      </p>
                    )}
                  </div>
                )}

                {/* 按鈕列 */}
                <div style={{ display: "flex", gap: "8px" }}>
                  <button
                    onClick={() => {
                      if (isGuest) alert("登入後可以幫餐廳評分，並讓推薦更準確喔！🍰");
                      else setFeedbackPlace(place);
                    }}
                    className="btn-primary"
                    style={{ flex: 1, padding: "10px", fontSize: "0.88rem", borderRadius: "12px" }}
                  >
                    ✅ 就決定是你了！
                  </button>
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.name)}&query_place_id=${place.id}`}
                    target="_blank" rel="noreferrer"
                    className="btn-secondary"
                    style={{ display: "inline-flex", alignItems: "center", padding: "10px 14px", fontSize: "0.88rem", borderRadius: "12px", textDecoration: "none" }}
                  >
                    🗺️
                  </a>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* 幸運轉盤 */}
      {!selectedPlace && !isSpinning && places.length > 1 && (
        <div style={{ marginTop: "2rem", textAlign: "center" }}>
          <p style={{ color: "var(--text-light)", marginBottom: "0.8rem", fontSize: "0.88rem" }}>選不出來嗎？🤔</p>
          <button className="btn-primary" onClick={handleRoulette}
            style={{ padding: "14px 36px", fontSize: "1.05rem", borderRadius: "30px" }}>
            🎰 讓命運決定！
          </button>
        </div>
      )}

      {/* 返回 */}
      {selectedPlace && !isSpinning && (
        <div style={{ marginTop: "1.5rem", textAlign: "center" }}>
          <button className="btn-secondary" onClick={() => setSelectedPlace(null)}>← 返回所有推薦</button>
        </div>
      )}

      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-8px)} }
        @keyframes spin { 0%{transform:rotate(0deg)} 100%{transform:rotate(360deg)} }
        @keyframes fadeIn { from{opacity:0;transform:translateY(14px)} to{opacity:1;transform:translateY(0)} }
      `}} />
    </div>
  );
}
