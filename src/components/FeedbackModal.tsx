"use client";

import { useState } from "react";

interface FeedbackModalProps {
  place: { id: string; name: string; address: string; photoRef: string | null; };
  onClose: () => void;
  onSubmitted: () => void;
  apiKey?: string;
}

export default function FeedbackModal({ place, onClose, onSubmitted, apiKey }: FeedbackModalProps) {
  const [rating, setRating] = useState(0);
  const [hoveredRating, setHoveredRating] = useState(0);
  const [priceLevel, setPriceLevel] = useState("");
  const [hours, setHours] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const photoUrl = place.photoRef && apiKey
    ? `https://maps.googleapis.com/maps/api/place/photo?maxwidth=600&photo_reference=${place.photoRef}&key=${apiKey}`
    : null;

  const handleSubmit = async () => {
    if (!rating) return;
    setSubmitting(true);
    try {
      await fetch("/api/places/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ placeId: place.id, rating, overridePrice: priceLevel || null, overrideHours: hours || null }),
      });
      setSubmitted(true);
      setTimeout(() => onSubmitted(), 1800);
    } finally { setSubmitting(false); }
  };

  const ratingLabels = ["", "很差 😞", "普通 😐", "還可以 🙂", "不錯 😊", "超棒 🤩"];

  const inputStyle: React.CSSProperties = {
    width: "100%", boxSizing: "border-box",
    background: "rgba(255,240,245,0.7)",
    border: "1.5px solid rgba(255,182,193,0.45)",
    borderRadius: "12px",
    padding: "10px 14px",
    color: "var(--text)",
    fontSize: "0.9rem",
    outline: "none",
    fontFamily: "inherit",
  };

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(255,240,248,0.6)", backdropFilter: "blur(8px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem", animation: "fadeIn 0.2s ease" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: "rgba(255,255,255,0.96)", borderRadius: "28px", border: "1.5px solid rgba(255,182,193,0.5)",
        boxShadow: "0 20px 60px rgba(255,135,165,0.15)", width: "100%", maxWidth: "400px",
        overflow: "hidden", animation: "fadeIn 0.3s ease",
      }}>
        {/* 照片 */}
        {photoUrl && (
          <div style={{ width: "100%", height: "150px", overflow: "hidden", position: "relative" }}>
            <img src={photoUrl} alt={place.name} style={{ width: "100%", height: "100%", objectFit: "cover" }}
              onError={(e) => { (e.currentTarget.parentElement!.style.display = "none"); }} />
            <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, rgba(255,248,252,0.95), transparent 60%)" }} />
            <h3 style={{ position: "absolute", bottom: "12px", left: "16px", margin: 0, fontSize: "1rem", color: "var(--text)" }}>{place.name}</h3>
          </div>
        )}

        <div style={{ padding: "1.5rem" }}>
          {!photoUrl && <h3 style={{ margin: "0 0 0.4rem", color: "var(--text)" }}>{place.name}</h3>}
          <p style={{ margin: "0 0 1.4rem", fontSize: "0.78rem", color: "var(--text-secondary)" }}>📍 {place.address}</p>

          {submitted ? (
            <div style={{ textAlign: "center", padding: "0.5rem 0 1rem" }}>
              <div style={{ fontSize: "3rem", marginBottom: "0.8rem" }}>🎉</div>
              <p style={{ fontWeight: 700, color: "var(--primary-dark)", fontSize: "1.05rem" }}>感謝您的評分！</p>
              <p style={{ fontSize: "0.82rem", color: "var(--text-secondary)", marginTop: "4px" }}>社群分數已更新</p>
            </div>
          ) : (
            <>
              {/* 星星評分 */}
              <p style={{ margin: "0 0 0.6rem", fontWeight: 700, fontSize: "0.9rem" }}>
                您的評分 <span style={{ color: "var(--primary)" }}>*</span>
              </p>
              <div style={{ display: "flex", gap: "6px", marginBottom: "0.4rem" }}>
                {[1, 2, 3, 4, 5].map(s => (
                  <button key={s} onClick={() => setRating(s)}
                    onMouseEnter={() => setHoveredRating(s)} onMouseLeave={() => setHoveredRating(0)}
                    style={{
                      background: "none", border: "none", cursor: "pointer", fontSize: "2rem", padding: "2px",
                      filter: (hoveredRating || rating) >= s ? "none" : "grayscale(1) opacity(0.3)",
                      transform: (hoveredRating || rating) === s ? "scale(1.25)" : "scale(1)",
                      transition: "all 0.12s ease",
                    }}>⭐</button>
                ))}
              </div>
              {rating > 0 && (
                <p style={{ margin: "0 0 1.2rem", fontSize: "0.8rem", color: "var(--primary)" }}>{ratingLabels[rating]}</p>
              )}
              {rating === 0 && <div style={{ marginBottom: "1.2rem" }} />}

              {/* 價位修正 */}
              <p style={{ margin: "0 0 0.5rem", fontWeight: 700, fontSize: "0.875rem" }}>
                修正價位 <span style={{ color: "var(--text-light)", fontWeight: 400 }}>(選填)</span>
              </p>
              <input type="text" placeholder="例：80–150元、250元左右" value={priceLevel}
                onChange={e => setPriceLevel(e.target.value)} style={{ ...inputStyle, marginBottom: "1.1rem" }} />

              {/* 營業時間修正 */}
              <p style={{ margin: "0 0 0.5rem", fontWeight: 700, fontSize: "0.875rem" }}>
                修正營業時間 <span style={{ color: "var(--text-light)", fontWeight: 400 }}>(選填)</span>
              </p>
              <input type="text" placeholder="例：11:00 – 22:00（週二公休）" value={hours}
                onChange={e => setHours(e.target.value)} style={{ ...inputStyle, marginBottom: "1.5rem" }} />

              {/* 按鈕 */}
              <div style={{ display: "flex", gap: "10px" }}>
                <button onClick={handleSubmit} disabled={!rating || submitting} className="btn-primary"
                  style={{ flex: 1, padding: "12px", borderRadius: "14px", opacity: !rating ? 0.5 : 1, cursor: !rating ? "not-allowed" : "pointer" }}>
                  {submitting ? "送出中..." : "✅ 送出評分"}
                </button>
                <button onClick={onClose} className="btn-secondary" style={{ padding: "12px 16px", borderRadius: "14px" }}>取消</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
