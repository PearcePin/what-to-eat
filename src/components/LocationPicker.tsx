"use client";

import { useState } from "react";

interface LocationResult { lat: number; lng: number; label: string; }

export default function LocationPicker({ onConfirm }: { onConfirm: (loc: LocationResult) => void }) {
  const [mode, setMode] = useState<"choose" | "gps" | "manual">("choose");
  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsError, setGpsError] = useState("");
  const [address, setAddress] = useState("");
  const [geocoding, setGeocoding] = useState(false);
  const [geocodeError, setGeocodeError] = useState("");

  const handleGPS = () => {
    setMode("gps");
    setGpsLoading(true);
    setGpsError("");

    if (!navigator.geolocation) {
      setGpsError("您的瀏覽器不支援 GPS 定位");
      setGpsLoading(false);
      setMode("manual");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGpsLoading(false);
        onConfirm({ lat: pos.coords.latitude, lng: pos.coords.longitude, label: "📍 目前位置" });
      },
      (err) => {
        setGpsLoading(false);
        if (err.code === 1) {
          setGpsError("⚠️ 您封鎖了位置存取。\n請到 Windows 設定 → 隱私權 → 位置，確認位置服務已開啟，\n或直接使用下方手動輸入。");
        } else if (err.code === 2) {
          setGpsError("⚠️ 無法取得位置訊號，請改用手動輸入地址。");
        } else {
          setGpsError("⚠️ 定位逾時，請改用手動輸入地址。");
        }
        setMode("manual");
      },
      { timeout: 8000, enableHighAccuracy: false }
    );
  };

  const handleGeocode = async () => {
    if (!address.trim()) return;
    setGeocoding(true);
    setGeocodeError("");
    try {
      const res = await fetch(`/api/geocode?address=${encodeURIComponent(address)}`);
      const data = await res.json();
      if (data.success) {
        onConfirm({ lat: data.lat, lng: data.lng, label: `📍 ${data.formattedAddress}` });
      } else {
        setGeocodeError(data.error || "找不到此地址，請試試更詳細的地址");
      }
    } catch { setGeocodeError("查詢失敗，請稍後再試"); }
    finally { setGeocoding(false); }
  };

  const inputStyle: React.CSSProperties = {
    width: "100%", boxSizing: "border-box",
    background: "rgba(255,240,245,0.7)",
    border: "1.5px solid rgba(255,182,193,0.45)",
    borderRadius: "14px",
    padding: "13px 16px",
    color: "var(--text)", fontSize: "1rem",
    outline: "none", fontFamily: "inherit",
  };

  return (
    <div className="glass-panel" style={{ animation: "fadeIn 0.5s ease", textAlign: "left" }}>
      <h2 style={{ fontSize: "1.3rem", marginBottom: "0.3rem" }}>📍 您在哪裡呢？</h2>
      <p style={{ color: "var(--text-secondary)", marginBottom: "1.8rem", fontSize: "0.88rem" }}>
        讓我們找到您附近的美食 🍰
      </p>

      {/* 選擇入口 */}
      {mode === "choose" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.8rem" }}>
          {/* GPS */}
          <button onClick={handleGPS}
            style={{
              background: "linear-gradient(135deg, rgba(255,182,193,0.2), rgba(197,179,232,0.2))",
              border: "1.5px solid rgba(255,182,193,0.5)",
              borderRadius: "18px", padding: "16px 18px",
              cursor: "pointer", textAlign: "left", fontFamily: "inherit",
              transition: "all 0.2s ease",
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = "translateY(-2px)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = "translateY(0)"; }}
          >
            <p style={{ margin: 0, fontWeight: 700, fontSize: "1rem", color: "var(--text)" }}>🛰️ GPS 自動定位</p>
            <p style={{ margin: "4px 0 0", fontSize: "0.78rem", color: "var(--text-secondary)" }}>最精準，需要允許瀏覽器存取位置</p>
          </button>

          {/* 手動 */}
          <button onClick={() => setMode("manual")}
            style={{
              background: "linear-gradient(135deg, rgba(163,204,224,0.2), rgba(158,219,192,0.2))",
              border: "1.5px solid rgba(163,204,224,0.5)",
              borderRadius: "18px", padding: "16px 18px",
              cursor: "pointer", textAlign: "left", fontFamily: "inherit",
              transition: "all 0.2s ease",
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = "translateY(-2px)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = "translateY(0)"; }}
          >
            <p style={{ margin: 0, fontWeight: 700, fontSize: "1rem", color: "var(--text)" }}>🗺️ 手動輸入地址</p>
            <p style={{ margin: "4px 0 0", fontSize: "0.78rem", color: "var(--text-secondary)" }}>輸入地址、捷運站名或地標</p>
          </button>
        </div>
      )}

      {/* GPS 載入中 */}
      {mode === "gps" && gpsLoading && (
        <div style={{ textAlign: "center", padding: "1rem 0" }}>
          <div style={{ width: "36px", height: "36px", margin: "0 auto 1rem", border: "3px solid rgba(255,182,193,0.2)", borderTop: "3px solid var(--primary)", borderRadius: "50%", animation: "spin 0.9s linear infinite" }} />
          <p style={{ color: "var(--text-secondary)" }}>正在取得您的位置...</p>
        </div>
      )}

      {/* 手動輸入 */}
      {mode === "manual" && (
        <div>
          {gpsError && (
            <div style={{ background: "rgba(255,182,193,0.15)", border: "1px solid rgba(255,182,193,0.4)", borderRadius: "12px", padding: "10px 14px", marginBottom: "1rem", fontSize: "0.8rem", color: "var(--error)", whiteSpace: "pre-line" }}>
              {gpsError}
            </div>
          )}
          <p style={{ fontSize: "0.84rem", color: "var(--text-secondary)", marginBottom: "0.6rem" }}>輸入地址、捷運站或地標</p>
          <input
            type="text"
            placeholder="例：信義區、忠孝敦化站、台大"
            value={address}
            onChange={e => setAddress(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleGeocode()}
            autoFocus
            style={{ ...inputStyle, marginBottom: "0.8rem" }}
          />
          {geocodeError && <p style={{ color: "var(--error)", fontSize: "0.83rem", marginBottom: "0.8rem" }}>⚠️ {geocodeError}</p>}
          <div style={{ display: "flex", gap: "10px" }}>
            <button className="btn-primary" onClick={handleGeocode} disabled={!address.trim() || geocoding}
              style={{ flex: 1, padding: "12px", borderRadius: "14px", opacity: !address.trim() ? 0.5 : 1 }}>
              {geocoding ? "查詢中..." : "確認地址 →"}
            </button>
            <button className="btn-secondary" onClick={() => { setMode("choose"); setGpsError(""); setGeocodeError(""); }}
              style={{ padding: "12px 16px", borderRadius: "14px" }}>
              返回
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
