"use client";

export const dynamic = "force-dynamic";

import { useState, useEffect } from "react";
import { User } from "firebase/auth";
import { auth, loginWithGoogle, logout } from "@/lib/firebase";
import Quiz from "@/components/Quiz";
import ResultDeck from "@/components/ResultDeck";
import LocationPicker from "@/components/LocationPicker";

interface Location { lat: number; lng: number; label: string; }

export default function Home() {
  const [started, setStarted] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [isGuest, setIsGuest] = useState(false);
  const [location, setLocation] = useState<Location | null>(null);
  const [filters, setFilters] = useState<any>(null);
  const [isFavMode, setIsFavMode] = useState(false);

  useEffect(() => {
    if (!auth) return;
    const unsubscribe = auth.onAuthStateChanged((u: any) => setUser(u));
    return () => unsubscribe();
  }, []);

  const handleLogin = async () => {
    try { await loginWithGoogle(); } catch (e) { console.error(e); }
  };

  const handleQuizComplete = (finalFilters: any) => setFilters(finalFilters);

  const showLanding  = !started && !user && !isGuest;
  const showLogin    = started && !user && !isGuest;
  const showLocation = (!!user || isGuest) && !location;
  const showQuiz     = (!!user || isGuest) && !!location && !filters && !isFavMode;
  const showResults  = (!!user || isGuest) && !!location && (!!filters || isFavMode);

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", paddingTop: "2rem" }}>

      {/* Hero 標題 */}
      <div style={{ marginBottom: "2rem", animation: "fadeIn 0.6s ease" }}>
        <h1 className="text-gradient" style={{ fontSize: "3.2rem", lineHeight: 1.2, marginBottom: "0.5rem" }}>
          要吃什麼？
        </h1>
        <p style={{ color: "var(--text-secondary)", fontSize: "0.95rem", maxWidth: "320px" }}>
          不再選擇困難！讓在地社群幫你決定下一餐 🍰
        </p>
      </div>

      {/* 開始按鈕 */}
      {showLanding && (
        <button className="btn-primary" onClick={() => setStarted(true)}
          style={{ fontSize: "1.1rem", padding: "16px 44px", animation: "fadeIn 0.8s ease" }}>
          ✨ 開始尋找美食
        </button>
      )}

      {/* 登入面板 */}
      {showLogin && (
        <div className="glass-panel" style={{ animation: "fadeIn 0.4s ease", textAlign: "left" }}>
          <h2 style={{ fontSize: "1.3rem", marginBottom: "0.5rem" }}>👋 歡迎！</h2>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem", marginBottom: "1.8rem" }}>
            登入後可以幫餐廳評分，讓推薦更準確
          </p>
          <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
            <button className="btn-secondary" onClick={() => setIsGuest(true)}>訪客繼續</button>
            <button className="btn-primary" onClick={handleLogin}>Google 登入</button>
          </div>
        </div>
      )}

      {/* 定位選擇 */}
      {showLocation && <LocationPicker onConfirm={(loc) => setLocation(loc)} />}

      {/* 模式選擇 (定位後) */}
      {(!!user || isGuest) && !!location && !filters && !isFavMode && (
        <div style={{ marginBottom: "1.5rem", display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "10px", animation: "fadeIn 0.5s ease" }}>
          <button className="btn-secondary" onClick={() => {
            if (isGuest) {
              if (window.confirm("登入後可以開啟「最愛抽籤」與「收藏」功能喔！是否現在前往登入？")) setIsGuest(false);
            } else {
              setIsFavMode(true);
            }
          }} style={{ padding: "10px 20px" }}>
            🎯 從收藏店家抽籤
          </button>
          <div style={{ width: "1px", background: "rgba(0,0,0,0.1)" }} />
          <p style={{ alignSelf: "center", margin: 0, fontSize: "0.85rem", color: "var(--text-light)" }}>或開始問卷推薦</p>
        </div>
      )}

      {/* 問卷 */}
      {showQuiz && <Quiz user={user!} onComplete={handleQuizComplete} />}

      {/* 結果 */}
      {showResults && <ResultDeck filters={filters} location={location!} user={user} isGuest={isGuest} isFavMode={isFavMode} onLoginRequest={() => { setLocation(null); setFilters(null); setIsFavMode(false); setIsGuest(false); }} />}

      {/* 位置標示 */}
      {user && location && (
        <p style={{ marginTop: "1rem", fontSize: "0.78rem", color: "var(--text-light)" }}>
          {filters || isFavMode ? (
            <button onClick={() => { setLocation(null); setFilters(null); setIsFavMode(false); }}
              style={{ marginLeft: "8px", color: "var(--primary)", background: "none", border: "none", cursor: "pointer", fontSize: "0.78rem", textDecoration: "underline", fontFamily: "inherit" }}>
              重新搜尋
            </button>
          ) : (
            <button onClick={() => setLocation(null)}
              style={{ marginLeft: "8px", color: "var(--primary)", background: "none", border: "none", cursor: "pointer", fontSize: "0.78rem", textDecoration: "underline", fontFamily: "inherit" }}>
              重選
            </button>
          )}
        </p>
      )}

      {/* 登出 / 訪客結束 */}
      {(user || isGuest) && (
        <button onClick={() => { logout(); setUser(null); setIsGuest(false); setLocation(null); setFilters(null); }}
          style={{ marginTop: "0.8rem", color: "var(--text-light)", background: "none", border: "none", cursor: "pointer", fontSize: "0.75rem", textDecoration: "underline", fontFamily: "inherit" }}>
          {user ? `登出 ${user.email}` : "結束訪客模式"}
        </button>
      )}
    </div>
  );
}
