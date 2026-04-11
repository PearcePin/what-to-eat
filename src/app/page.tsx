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
  const [isViewFavMode, setIsViewFavMode] = useState(false);

  // --- 瀏覽器返回鍵管理 (History API) ---
  useEffect(() => {
    // 初始進入時，將當前狀態記錄為 landing
    if (window.history.state === null) {
      window.history.replaceState({ step: "landing" }, "");
    }

    const handlePopState = (event: PopStateEvent) => {
      const state = event.state;
      if (!state) return;

      // 根據歷史記錄的 state 回退狀態
      if (state.step === "landing") {
        setStarted(false);
        setIsGuest(false);
        setLocation(null);
        setFilters(null);
        setIsFavMode(false);
        setIsViewFavMode(false);
      } else if (state.step === "login") {
        setStarted(true);
        setIsGuest(false);
        setLocation(null);
        setFilters(null);
      } else if (state.step === "location") {
        setLocation(null);
        setFilters(null);
        setIsFavMode(false);
        setIsViewFavMode(false);
      } else if (state.step === "quiz") {
        setFilters(null);
        setIsFavMode(false);
        setIsViewFavMode(false);
      }
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const pushStep = (step: string) => {
    window.history.pushState({ step }, "");
  };

  const handleStart = () => {
    setStarted(true);
    pushStep("login");
  };

  const handleGuestMode = () => {
    setIsGuest(true);
    pushStep("location");
  };

  const handleLocationConfirm = (loc: Location) => {
    setLocation(loc);
    pushStep("quiz");
  };

  const handleQuizComplete = (finalFilters: any) => {
    setFilters(finalFilters);
    pushStep("results");
  };

  const handleToggleFavMode = (mode: "fav" | "view") => {
    if (mode === "fav") setIsFavMode(true);
    else setIsViewFavMode(true);
    pushStep("results");
  };

  const handleReselectLocation = () => {
    setLocation(null);
    setFilters(null);
    setIsFavMode(false);
    setIsViewFavMode(false);
    pushStep("location");
  };

  const handleReselectCriteria = () => {
    setFilters(null);
    setIsFavMode(false);
    setIsViewFavMode(false);
    pushStep("quiz");
  };

  const showLanding  = !started && !user && !isGuest;
  const showLogin    = started && !user && !isGuest;
  const showLocation = (!!user || isGuest) && !location;
  const showQuiz     = (!!user || isGuest) && !!location && !filters && !isFavMode && !isViewFavMode;
  const showResults  = (!!user || isGuest) && !!location && (!!filters || isFavMode || isViewFavMode);

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", paddingTop: "2rem", position: "relative" }}>
      
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
        <button className="btn-primary" onClick={handleStart}
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
            <button className="btn-secondary" onClick={handleGuestMode}>訪客繼續</button>
            <button className="btn-primary" onClick={handleLogin}>Google 登入</button>
          </div>
        </div>
      )}

      {/* 定位選擇 */}
      {showLocation && <LocationPicker onConfirm={handleLocationConfirm} />}

      {/* 模式選擇 (定位後) */}
      {(!!user || isGuest) && !!location && !filters && !isFavMode && !isViewFavMode && (
        <div style={{ marginBottom: "1.5rem", display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "10px", animation: "fadeIn 0.5s ease" }}>
          <button className="btn-secondary" onClick={() => {
            if (isGuest) {
              if (window.confirm("登入後可以開啟「最愛抽籤」與「收藏」功能喔！是否現在前往登入？")) {
                setIsGuest(false);
                pushStep("login");
              }
            } else {
              handleToggleFavMode("fav");
            }
          }} style={{ padding: "10px 20px" }}>
            🎯 抽收藏店家
          </button>
          <button className="btn-secondary" onClick={() => {
            if (isGuest) {
              if (window.confirm("登入後可以查看您的收藏店家！是否現在前往登入？")) {
                setIsGuest(false);
                pushStep("login");
              }
            } else {
              handleToggleFavMode("view");
            }
          }} style={{ padding: "10px 20px" }}>
            📜 瀏覽所有收藏
          </button>
          <div style={{ width: "100%", height: "8px" }} />
          <button className="btn-primary" onClick={() => {}} style={{ padding: "10px 30px", pointerEvents: "none", opacity: 0.9 }}>
            或者 👇
          </button>
        </div>
      )}

      {/* 問卷 */}
      {showQuiz && <Quiz user={user!} onComplete={handleQuizComplete} />}

      {/* 結果與導航按鈕 */}
      {showResults && (
        <div style={{ width: "100%", maxWidth: "480px", animation: "fadeIn 0.5s ease" }}>
          {/* 功能按鈕列 */}
          <div style={{ display: "flex", gap: "10px", marginBottom: "1.2rem", padding: "0 1.2rem" }}>
            <button className="btn-secondary" onClick={handleReselectLocation} style={{ flex: 1, padding: "12px", borderRadius: "14px", fontSize: "0.9rem" }}>
              📍 重選地點
            </button>
            <button className="btn-secondary" onClick={handleReselectCriteria} style={{ flex: 1, padding: "12px", borderRadius: "14px", fontSize: "0.9rem" }}>
              📋 重選條件
            </button>
          </div>
          
          <ResultDeck filters={filters} location={location!} user={user} isGuest={isGuest} isFavMode={isFavMode} isViewFavMode={isViewFavMode} onLoginRequest={() => { setLocation(null); setFilters(null); setIsGuest(false); pushStep("login"); }} />
        </div>
      )}

      {/* 地點標示 (僅在未填問卷時顯示微調按鈕) */}
      {(user || isGuest) && location && !filters && !isFavMode && !isViewFavMode && (
        <p style={{ marginTop: "1rem", fontSize: "0.78rem", color: "var(--text-light)" }}>
          📍 目前位置：{location.label}
          <button onClick={() => setLocation(null)}
            style={{ marginLeft: "8px", color: "var(--primary)", background: "none", border: "none", cursor: "pointer", fontSize: "0.78rem", textDecoration: "underline", fontFamily: "inherit" }}>
            (點我重選)
          </button>
        </p>
      )}

      {/* 登出 / 訪客結束 */}
      {(user || isGuest) && (
        <button onClick={() => { logout(); setUser(null); setIsGuest(false); setLocation(null); setFilters(null); pushStep("landing"); }}
          style={{ marginTop: "1.5rem", color: "var(--text-light)", background: "none", border: "none", cursor: "pointer", fontSize: "0.75rem", textDecoration: "underline", opacity: 0.6 }}>
          {user ? `登出 ${user.email}` : "結束訪客模式"}
        </button>
      )}
    </div>
  );
}
