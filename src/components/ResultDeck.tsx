"use client";

import { useState, useEffect, useRef } from "react";
import FeedbackModal from "./FeedbackModal";
import { storage } from "@/lib/firebase";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";

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

export default function ResultDeck({ filters, location, user, isGuest, isFavMode, isViewFavMode, onLoginRequest }: { filters: any; location: Location; user: any; isGuest: boolean; isFavMode?: boolean; isViewFavMode?: boolean; onLoginRequest?: () => void }) {
  const [loading, setLoading] = useState(true);
  const [places, setPlaces] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [isSpinning, setIsSpinning] = useState(false);
  const [selectedPlace, setSelectedPlace] = useState<any>(null);
  const [feedbackPlace, setFeedbackPlace] = useState<any>(null);
  const [userFavorites, setUserFavorites] = useState<string[]>([]);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [expandedComments, setExpandedComments] = useState<string | null>(null);
  const [allResultsPool, setAllResultsPool] = useState<any[]>([]); // 全量大池子，換一批從這裡取
  const [poolOffset, setPoolOffset] = useState(0); // 目前顯示的是池子的哪個 Slice

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

  useEffect(() => {
    if (isFavMode) fetchFavList(true);
    else if (isViewFavMode) fetchFavList(false);
    else fetchPlaces();
    if (user) fetchFavorites();
  }, [filters, isFavMode, isViewFavMode]);

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

  const fetchFavList = async (autoSpin: boolean) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/favorites?email=${user.email}`);
      const data = await res.json();
      if (data.success) {
        let favs = data.favorites
          .map((f: any) => f.place)
          .map((p: any) => {
            const dist = p.lat ? getDistance(location.lat, location.lng, p.lat, p.lng) : 0;
            return {
              ...p,
              id: p.place_id,
              photoRef: p.photo_ref,
              finalScore: p.avg_user_rating > 0 ? p.avg_user_rating.toFixed(1) : "–",
              distanceText: p.lat ? `${dist.toFixed(1)} km` : null,
              _dist: dist
            };
          });

        if (autoSpin) {
          favs = favs.filter((p: any) => !p.lat || p._dist <= 10);
        } else {
          favs.sort((a: any, b: any) => a._dist - b._dist);
        }

        if (favs.length === 0) {
          setError(autoSpin ? "10公里內沒有找到您的收藏店家喔！" : "您還沒有收藏任何餐廳喔！");
        } else {
          setPlaces(favs);
          if (autoSpin) setTimeout(() => handleRoulette(), 500);
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
      if (window.confirm("這項功能需要登入解鎖喔！是否現在前往登入？")) {
        if (onLoginRequest) onLoginRequest();
      }
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
    setPoolOffset(0);
    let radius = "1000";
    if (filters?.transport?.includes("腳踏車")) radius = "3000";
    if (filters?.transport?.includes("汽機車")) radius = "5000";

    try {
      const url = `/api/places/search?type=${encodeURIComponent(filters?.type || "")}&radius=${radius}&lat=${location.lat}&lng=${location.lng}&budget=${encodeURIComponent(filters?.budget || "")}&meal=${encodeURIComponent(filters?.meal || "")}`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.success) {
        const deck = data.deck || [];
        if (deck.length === 0) {
          setError("範圍內沒有找到符合條件的店家，試試放寬距離或調整條件吧！");
        } else {
          setAllResultsPool(deck); // 整副牌 (已在後端依相關性+距離排序)
          
          // 智能推薦邏輯：優先從前 30 筆相關性最高的店中隨機抽 10 筆
          const topCandidates = deck.slice(0, Math.min(30, deck.length));
          const hand = [...topCandidates].sort(() => Math.random() - 0.5).slice(0, 10);
          
          setPlaces(hand);
          setNextPageToken(null);
          setError("");
        }
      } else setError(data.error || "無法載入餐廳資料");
    } catch { setError("連線錯誤"); }
    finally { setLoading(false); }
  };

  // 換一批：同樣優先從高品質候選池中抽選
  const changeBatch = () => {
    if (!allResultsPool.length) return;
    const topCandidates = allResultsPool.slice(0, Math.min(30, allResultsPool.length));
    const hand = [...topCandidates].sort(() => Math.random() - 0.5).slice(0, 10);
    setPlaces(hand);
    setSelectedPlace(null);
  };

  // 命運決定：從整副牌裡隨機抽 1 張
  const handleRoulette = () => {
    const pool = allResultsPool.length > 0 ? allResultsPool : places;
    if (!pool.length) return;
    setIsSpinning(true);
    setSelectedPlace(null);
    let count = 0;
    const iv = setInterval(() => {
      setSelectedPlace(pool[Math.floor(Math.random() * pool.length)]);
      if (++count > 20) { clearInterval(iv); setIsSpinning(false); }
    }, 100);
  };

  const getPhotoUrl = (ref: string | null) => {
    if (!ref || !apiKey) return null;
    // 新版 API 格式：places/PLACE_ID/photos/PHOTO_ID
    if (ref.startsWith("places/")) {
      return `https://places.googleapis.com/v1/${ref}/media?maxHeightPx=400&maxWidthPx=400&key=${apiKey}`;
    }
    // 舊版格式 (用於快照資料)
    return `https://maps.googleapis.com/maps/api/place/photo?maxwidth=600&photo_reference=${ref}&key=${apiKey}`;
  };

  const getPriceLabel = (place: any) => {
    const level = place.priceLevel;
    const range = place.priceRange;

    // 優先顯示精確範圍 (例如: $400 - $600)
    if (range?.startPrice?.units && range?.endPrice?.units) {
      return `💰 $${range.startPrice.units} - ${range.endPrice.units}`;
    } else if (range?.startPrice?.units) {
      return `💰 ~$${range.startPrice.units}`;
    }

    // 次之顯示等級
    const icons = level === 1 ? "$" : level === 2 ? "$$" : level === 3 ? "$$$" : level >= 4 ? "$$$$" : "";
    if (level === 1) return `💰 ${icons} (平價)`;
    if (level === 2) return `💰 ${icons} (中等)`;
    if (level === 3) return `💰 ${icons} (高價)`;
    if (level >= 4) return `💰 ${icons} (頂級)`;
    return null;
  };

  /* ──── 專屬於每個店家的留言區組件 ──── */
  const CommentSection = ({ placeId }: { placeId: string }) => {
    const [comments, setComments] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [text, setText] = useState("");
    const [uploading, setUploading] = useState(false);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const fetchComments = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/places/comment?placeId=${placeId}`);
        const data = await res.json();
        if (data.success) setComments(data.comments);
      } catch (e) { console.error(e); }
      finally { setLoading(false); }
    };

    useEffect(() => { fetchComments(); }, [placeId]);

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      
      setUploading(true);
      try {
        const imgRef = ref(storage!, `comments/${placeId}/${Date.now()}_${file.name}`);
        await uploadBytes(imgRef, file);
        const url = await getDownloadURL(imgRef);
        setPreviewUrl(url);
      } catch (e) {
        alert("圖片上傳失敗，請稍後再試");
        console.error(e);
      } finally {
        setUploading(false);
      }
    };

    const submitComment = async () => {
      if (!text.trim()) return;
      if (!user) return onLoginRequest?.();

      try {
        const res = await fetch("/api/places/comment", {
          method: "POST",
          body: JSON.stringify({
            placeId,
            text,
            imageUrl: previewUrl,
            userName: user.displayName,
            userPhoto: user.photoURL,
            userEmail: user.email
          })
        });
        const data = await res.json();
        if (data.success) {
          setText("");
          setPreviewUrl(null);
          fetchComments();
        }
      } catch (e) { console.error(e); }
    };

    return (
      <div style={{ padding: "1rem", background: "rgba(0,0,0,0.03)", borderRadius: "0 0 20px 20px", borderTop: "1.5px solid var(--card-border)" }}>
        <h4 style={{ margin: "0 0 0.8rem", fontSize: "0.9rem", color: "var(--text)" }}>💬 網友心得 ({comments.length})</h4>
        
        {/* 留言列表 */}
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem", marginBottom: "1rem", maxHeight: "250px", overflowY: "auto" }}>
          {loading ? <p style={{ fontSize: "0.8rem", color: "var(--text-light)" }}>載入中...</p> : 
           comments.length === 0 ? <p style={{ fontSize: "0.8rem", color: "var(--text-light)" }}>目前還沒有心得喔，來當第一個吧！</p> :
           comments.map(c => (
             <div key={c.id} style={{ display: "flex", gap: "10px" }}>
               {c.userPhoto && <img src={c.userPhoto} style={{ width: "32px", height: "32px", borderRadius: "50%" }} />}
               <div style={{ flex: 1 }}>
                 <div style={{ display: "flex", justifyContent: "space-between" }}>
                   <span style={{ fontSize: "0.8rem", fontWeight: 700 }}>{c.userName || "匿名"}</span>
                   <span style={{ fontSize: "0.7rem", color: "var(--text-light)" }}>{new Date(c.createdAt).toLocaleDateString()}</span>
                 </div>
                 <p style={{ margin: "4px 0", fontSize: "0.85rem", color: "var(--text-secondary)" }}>{c.text}</p>
                 {c.imageUrl && (
                   <img src={c.imageUrl} style={{ width: "100%", maxWidth: "120px", borderRadius: "8px", marginTop: "4px", cursor: "zoom-in" }} onClick={() => window.open(c.imageUrl, "_blank")} />
                 )}
               </div>
             </div>
           ))}
        </div>

        {/* 發表留言區 */}
        {user ? (
          <div style={{ background: "#fff", padding: "8px", borderRadius: "12px", border: "1px solid var(--card-border)" }}>
            <textarea 
              placeholder="分享一下這家店好不好吃..."
              value={text}
              onChange={e => setText(e.target.value)}
              style={{ width: "100%", border: "none", outline: "none", resize: "none", fontSize: "0.85rem", minHeight: "60px", fontFamily: "inherit" }}
            />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "6px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <button 
                  onClick={() => fileInputRef.current?.click()}
                  style={{ background: "none", border: "none", cursor: "pointer", fontSize: "1.1rem", opacity: uploading ? 0.4 : 1 }}
                  disabled={uploading}
                >
                  📷
                </button>
                <input type="file" ref={fileInputRef} onChange={handleFileChange} style={{ display: "none" }} accept="image/*" />
                {previewUrl && <span style={{ fontSize: "0.7rem", color: "var(--primary)" }}>✓ 已選圖片</span>}
                {uploading && <span style={{ fontSize: "0.7rem", color: "var(--text-light)" }}>上傳中...</span>}
              </div>
              <button className="btn-primary" onClick={submitComment} style={{ padding: "4px 14px", fontSize: "0.8rem" }}>傳送</button>
            </div>
          </div>
        ) : (
          <p style={{ fontSize: "0.75rem", textAlign: "center", color: "var(--text-light)" }}>
            請先 <button onClick={() => onLoginRequest?.()} style={{ color: "var(--primary)", background: "none", border: "none", textDecoration: "underline", padding: 0, cursor: "pointer", fontSize: "0.75rem" }}>登入</button> 發表心得
          </p>
        )}
      </div>
    );
  };

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
          {isViewFavMode ? "📜 我的收藏清單" : `🍴 附近推薦 (${allResultsPool.length} 個結果)`}
        </h3>
        {!selectedPlace && !isViewFavMode && !isFavMode && (
          <button className="btn-secondary" style={{ padding: "6px 16px", fontSize: "0.82rem" }} onClick={changeBatch}>
            🔄 換一批
          </button>
        )}
      </div>

      {/* 幸運轉盤 (移到最上方) */}
      {!selectedPlace && !isSpinning && places.length > 1 && (
        <div style={{ marginBottom: "1.5rem", textAlign: "center", animation: "fadeIn 0.7s ease" }}>
          <button className="btn-primary" onClick={handleRoulette}
            style={{ padding: "14px 0", fontSize: "1.05rem", borderRadius: "16px", width: "100%", boxShadow: "0 4px 15px rgba(255,155,176,0.3)" }}>
            🎰 選不出來嗎？讓命運決定！
          </button>
        </div>
      )}

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
                  {(place.priceLevel != null || place.priceRange) && (
                    <Tag color="#B08030" bg="rgba(240,225,200,0.4)" border="rgba(240,220,180,0.8)">
                      {getPriceLabel(place)}
                    </Tag>
                  )}
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
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleFavorite(place); }}
                    className="btn-secondary"
                    style={{ padding: "10px", fontSize: "0.88rem", borderRadius: "12px", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", flex: 1 }}
                  >
                    {userFavorites.includes(place.id) ? "❤️ 已收藏" : "🤍 加入最愛"}
                  </button>
                  <button
                    onClick={() => {
                      if (isGuest) {
                        if (window.confirm("登入後可以幫餐廳評分並紀錄歷史喔！是否現在前往登入？")) {
                          if (onLoginRequest) onLoginRequest();
                        }
                      } else setFeedbackPlace(place);
                    }}
                    className="btn-primary"
                    style={{ padding: "10px", fontSize: "0.88rem", borderRadius: "12px", flex: 1.5 }}
                  >
                    ✅ {isGuest ? "前往評分解鎖功能" : "就決定是你了！"}
                  </button>
                  {/* 導航 (獨立一排且更大) */}
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.name)}&query_place_id=${place.id}`}
                    target="_blank" rel="noreferrer"
                    className="btn-secondary"
                    style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "12px", fontSize: "0.95rem", fontWeight: 700, borderRadius: "12px", textDecoration: "none", width: "100%", marginTop: "4px" }}
                  >
                    🗺️ Google Maps 導航
                  </a>
                  {/* 查看心得按鈕 */}
                  <button
                    onClick={(e) => { e.stopPropagation(); setExpandedComments(prev => prev === place.id ? null : place.id); }}
                    className="btn-secondary"
                    style={{ background: "rgba(0,0,0,0.03)", border: "1px dashed var(--card-border)", color: "var(--text-secondary)", fontSize: "0.82rem", width: "100%", marginTop: "8px", borderRadius: "10px" }}
                  >
                    {expandedComments === place.id ? "🔼 收起心得" : "💬 查看網友心得"}
                  </button>
                </div>
              </div>
              
              {/* 展開的留言區 */}
              {expandedComments === place.id && <CommentSection placeId={place.id} />}
            </div>
          );
        })}
      </div>


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
