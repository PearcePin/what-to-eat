"use client";

import { useState } from "react";
import { User } from "firebase/auth";

const TYPES = ['🍲 火鍋', '🍱 日式', '🍝 義式', '🥢 台式小吃', '☕ 咖啡廳', '🎲 隨便'];
const BUDGETS = ['100元以下（銅板美食）', '100–300元（一般餐廳）', '300–600元（質感餐廳）', '600元以上（高級料理）'];
const TRANSPORTS = ['🚶 步行（1km以內）', '🚲 腳踏車（3km以內）', '🚗 汽機車（10km以內）'];

const STEPS = ['今天想吃什麼？', '預算大概多少？', '打算怎麼前往？'];

const COLORS = ['#FFB7C5', '#FFD2B0', '#FFE599', '#B8E0CF', '#A3CCE0', '#C5B3E8'];

export default function Quiz({ user, onComplete }: { user: User; onComplete: (f: any) => void }) {
  const [step, setStep] = useState(0);
  const [filters, setFilters] = useState({ type: '', budget: '', transport: '' });

  const lists = [TYPES, BUDGETS, TRANSPORTS];
  const keys  = ['type', 'budget', 'transport'] as const;

  const choose = (value: string) => {
    const key = keys[step];
    const next = { ...filters, [key]: value };
    if (step < 2) {
      setFilters(next);
      setStep(s => s + 1);
    } else {
      onComplete(next);
    }
  };

  const progress = ((step) / 3) * 100;

  return (
    <div className="glass-panel" style={{ animation: "fadeIn 0.5s ease", textAlign: "left" }}>
      {/* 問候 */}
      <p style={{ fontSize: "0.85rem", color: "var(--primary)", fontWeight: 700, marginBottom: "0.2rem" }}>
        嗨，{user.displayName?.split(' ')[0] ?? '你'} 👋
      </p>

      {/* 標題 */}
      <h2 style={{ fontSize: "1.3rem", marginBottom: "0.3rem", color: "var(--text)" }}>
        {STEPS[step]}
      </h2>

      {/* 步驟指示器 */}
      <div style={{ display: "flex", gap: "6px", marginBottom: "1.6rem" }}>
        {[0, 1, 2].map(i => (
          <div key={i} style={{
            flex: 1, height: "5px", borderRadius: "99px",
            background: i <= step ? "var(--primary)" : "rgba(0,0,0,0.08)",
            transition: "background 0.3s ease",
          }} />
        ))}
      </div>

      {/* 選項按鈕 */}
      <div style={{ display: "flex", flexDirection: "column", gap: "0.7rem" }}>
        {lists[step].map((item, idx) => (
          <button
            key={item}
            onClick={() => choose(item)}
            style={{
              background: `${COLORS[idx % COLORS.length]}33`,
              border: `1.5px solid ${COLORS[idx % COLORS.length]}`,
              borderRadius: "16px",
              padding: "13px 18px",
              fontSize: "1rem",
              fontWeight: 600,
              color: "var(--text)",
              cursor: "pointer",
              textAlign: "left",
              transition: "all 0.18s ease",
              fontFamily: "inherit",
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLElement).style.transform = "translateX(6px)";
              (e.currentTarget as HTMLElement).style.background = `${COLORS[idx % COLORS.length]}55`;
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLElement).style.transform = "translateX(0)";
              (e.currentTarget as HTMLElement).style.background = `${COLORS[idx % COLORS.length]}33`;
            }}
          >
            {item}
          </button>
        ))}
      </div>

      {/* 返回 */}
      {step > 0 && (
        <button
          onClick={() => setStep(s => s - 1)}
          style={{ marginTop: "1rem", color: "var(--text-secondary)", fontSize: "0.83rem", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit" }}
        >
          ← 上一步
        </button>
      )}
    </div>
  );
}
