"use client";

import { useState } from "react";
import { User } from "firebase/auth";

const STEPS = ['現在想吃哪一餐？', '想吃什麼樣的？', '預算大概多少？', '打算怎麼前往？'];

const MEALS = ['🥪 早餐', '🍱 午餐', '🍽️ 晚餐', '🌙 消夜', '🍰 點心'];

const MEAL_TO_TYPES: Record<string, string[]> = {
  '🥪 早餐': ['🥪 三明治', '🍳 蛋餅/豆漿', '🍔 早午餐/漢堡', '🥣 傳統中式', '☕ 咖啡輕食'],
  '🍱 午餐': ['🍲 火鍋', '🍱 日式/壽司', '🍝 義式/西餐', '🥢 台式小吃', '🥩 排餐/牛排', '🥡 便當/快餐', '🎲 隨便'],
  '🍽️ 晚餐': ['🍲 火鍋', '🍱 日式/壽司', '🍝 義式/西餐', '🥢 台式小吃', '🥩 排餐/牛排', '🍢 串燒/居酒屋', '🎲 隨便'],
  '🌙 消夜': ['🍗 鹹酥雞', '🍢 串燒', '🥘 滷味', '🍲 火鍋', '🥣 涼麵/宵夜粥', '🍢 居酒屋'],
  '🍰 點心': ['🧋 飲料', '🍰 甜點', '☕ 咖啡廳'],
};

const BUDGETS = ['100元以下 (銅板美食)', '100–300元 (一般餐廳)', '300–600元 (質感餐廳)', '600元以上 (進階料理)', '今天不談錢的事 💸'];
const TRANSPORTS = ['🚶 步行（1km以內）', '🚲 腳踏車（3km以內）', '🚗 汽機車（10km以內）'];

const COLORS = ['#FFB7C5', '#FFD2B0', '#FFE599', '#B8E0CF', '#A3CCE0', '#C5B3E8'];

export default function Quiz({ user, onComplete }: { user: User; onComplete: (f: any) => void }) {
  const [step, setStep] = useState(0);
  const [filters, setFilters] = useState({ meal: '', type: '', budget: '', transport: '' });

  // 動態決定當前步驟的選項列表
  const getCurrentList = () => {
    if (step === 0) return MEALS;
    if (step === 1) return MEAL_TO_TYPES[filters.meal] || MEAL_TO_TYPES['🍱 午餐'];
    if (step === 2) return BUDGETS;
    if (step === 3) return TRANSPORTS;
    return [];
  };

  const keys = ['meal', 'type', 'budget', 'transport'] as const;

  const choose = (value: string) => {
    const key = keys[step];
    const next = { ...filters, [key]: value };
    
    // 邏輯優化：早餐跟消夜跳過第二題
    if (step === 0) {
      if (value === '🥪 早餐' || value === '🌙 消夜') {
        const jumpedNext = { ...next, type: '' }; // 清空 type，由 meal 關鍵字主導搜尋
        setFilters(jumpedNext);
        setStep(2); // 直接跳到預算
        return;
      }
    }

    setFilters(next);
    if (step < 3) {
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
        嗨，{user?.displayName?.split(' ')[0] ?? '美食探險家'} 👋
      </p>

      {/* 標題 */}
      <h2 style={{ fontSize: "1.3rem", marginBottom: "0.3rem", color: "var(--text)" }}>
        {STEPS[step]}
      </h2>

      {/* 步驟指示器 */}
      <div style={{ display: "flex", gap: "6px", marginBottom: "1.6rem" }}>
        {[0, 1, 2, 3].map(i => (
          <div key={i} style={{
            flex: 1, height: "5px", borderRadius: "99px",
            background: i <= step ? "var(--primary)" : "rgba(0,0,0,0.08)",
            transition: "background 0.3s ease",
          }} />
        ))}
      </div>

      {/* 選項按鈕 */}
      <div style={{ display: "flex", flexDirection: "column", gap: "0.7rem" }}>
        {getCurrentList().map((item, idx) => (
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
          onClick={() => {
            // 如果目前在預算頁且是早餐或消夜，要跳回第一題
            if (step === 2 && (filters.meal === '🥪 早餐' || filters.meal === '🌙 消夜')) {
              setStep(0);
            } else {
              setStep(s => s - 1);
            }
          }}
          style={{ marginTop: "1rem", color: "var(--text-secondary)", fontSize: "0.83rem", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit" }}
        >
          ← 上一步
        </button>
      )}
    </div>
  );
}
