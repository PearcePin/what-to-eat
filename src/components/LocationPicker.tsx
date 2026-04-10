"use client";

import { useState, useEffect, useRef } from "react";

interface LocationResult { lat: number; lng: number; label: string; }

export default function LocationPicker({ onConfirm }: { onConfirm: (loc: LocationResult) => void }) {
  const mapRef = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<any>(null);
  const [marker, setMarker] = useState<any>(null);
  const [geocoder, setGeocoder] = useState<any>(null);
  
  const [address, setAddress] = useState("");
  const [loadingMsg, setLoadingMsg] = useState("正在載入地圖...");
  const [errorMsg, setErrorMsg] = useState("");

  const [currentLoc, setCurrentLoc] = useState<{lat: number, lng: number} | null>(null);

  // 初始化 Google Maps
  useEffect(() => {
    const initMap = () => {
      const gmaps = (window as any).google.maps;
      const initialPos = { lat: 25.033964, lng: 121.564468 }; // 預設台北 101

      const newMap = new gmaps.Map(mapRef.current, {
        center: initialPos,
        zoom: 16,
        disableDefaultUI: true,
        zoomControl: true,
      });

      const newMarker = new gmaps.Marker({
        position: initialPos,
        map: newMap,
        draggable: true,
        animation: gmaps.Animation.DROP,
        icon: {
           url: "https://maps.google.com/mapfiles/ms/icons/red-dot.png",
           scaledSize: new gmaps.Size(40, 40)
        }
      });

      const newGeocoder = new gmaps.Geocoder();

      setMap(newMap);
      setMarker(newMarker);
      setGeocoder(newGeocoder);
      setCurrentLoc(initialPos);
      setLoadingMsg("");
      
      reverseGeocode(initialPos, newGeocoder);

      // 拖曳圖釘事件
      newMarker.addListener("dragend", () => {
        const pos = newMarker.getPosition();
        const newPos = { lat: pos.lat(), lng: pos.lng() };
        setCurrentLoc(newPos);
        reverseGeocode(newPos, newGeocoder);
        newMap.panTo(newPos);
      });

      // 點擊地圖事件
      newMap.addListener("click", (e: any) => {
        const newPos = { lat: e.latLng.lat(), lng: e.latLng.lng() };
        newMarker.setPosition(newPos);
        setCurrentLoc(newPos);
        reverseGeocode(newPos, newGeocoder);
        newMap.panTo(newPos);
      });
    };

    if (!(window as any).google?.maps) {
      const script = document.createElement("script");
      script.src = `https://maps.googleapis.com/maps/api/js?key=${process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY}&libraries=places`;
      script.async = true;
      script.defer = true;
      script.onload = initMap;
      document.head.appendChild(script);
    } else {
      initMap();
    }
  }, []);

  const reverseGeocode = (pos: {lat: number, lng: number}, coder: any) => {
    setLoadingMsg("解析地址中...");
    coder.geocode({ location: pos }, (results: any, status: string) => {
      setLoadingMsg("");
      if (status === "OK" && results[0]) {
        // 嘗試拿比較簡短的地址 (去除國家/郵遞區號)
        let addr = results[0].formatted_address;
        addr = addr.replace(/^[^a-zA-Z0-9\u4e00-\u9fa5]+|台灣|Taiwan|\d{3,5}/g, '').trim();
        setAddress(addr);
      } else {
        setAddress("未知位置，但可作為定位點");
      }
    });
  };

  const handleGPS = () => {
    if (!navigator.geolocation) {
      setErrorMsg("您的瀏覽器不支援 GPS 定位");
      return;
    }
    setLoadingMsg("尋找您的位置中...");
    setErrorMsg("");

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const newPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setCurrentLoc(newPos);
        map.panTo(newPos);
        map.setZoom(17);
        marker.setPosition(newPos);
        reverseGeocode(newPos, geocoder);
        setLoadingMsg("");
      },
      (err) => {
        setLoadingMsg("");
        if (err.code === 1) setErrorMsg("您封鎖了位置存取，請手動拖曳圖釘或輸入地址");
        else setErrorMsg("無法取得位置，請手動拖曳圖釘");
      },
      { timeout: 8000, enableHighAccuracy: false }
    );
  };

  const handleSearch = async () => {
    if (!address.trim() || !geocoder) return;
    setLoadingMsg("搜尋中...");
    setErrorMsg("");
    geocoder.geocode({ address: address }, (results: any, status: string) => {
      setLoadingMsg("");
      if (status === "OK" && results[0]) {
        const newPos = { lat: results[0].geometry.location.lat(), lng: results[0].geometry.location.lng() };
        setCurrentLoc(newPos);
        map.panTo(newPos);
        map.setZoom(17);
        marker.setPosition(newPos);
        let addr = results[0].formatted_address;
        addr = addr.replace(/^[^a-zA-Z0-9\u4e00-\u9fa5]+|台灣|Taiwan|\d{3,5}/g, '').trim();
        setAddress(addr);
      } else {
        setErrorMsg("找不到該地址，請嘗試其他關鍵字");
      }
    });
  };

  return (
    <div className="glass-panel" style={{ width: "100%", maxWidth: "500px", padding: 0, overflow: "hidden", animation: "fadeIn 0.5s ease", textAlign: "left", display: "flex", flexDirection: "column" }}>
      {/* 標題與說明 */}
      <div style={{ padding: "1.2rem 1.5rem" }}>
        <h2 style={{ fontSize: "1.2rem", margin: 0, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          📍 選擇您的位置
          <button onClick={handleGPS} style={{ background: "rgba(255,182,193,0.2)", border: "1px solid rgba(255,182,193,0.5)", borderRadius: "20px", padding: "6px 12px", fontSize: "0.8rem", cursor: "pointer", color: "var(--primary-dark)", fontWeight: "bold" }}>
             🎯 找我
          </button>
        </h2>
        <p style={{ color: "var(--text-secondary)", marginTop: "0.4rem", marginBottom: 0, fontSize: "0.82rem" }}>
          拖曳地圖上的圖釘，精準選擇要吃哪裡周圍的美食
        </p>
      </div>

      {/* 地圖容器 */}
      <div style={{ position: "relative", width: "100%", height: "260px", background: "#f0f0f0" }}>
        <div ref={mapRef} style={{ width: "100%", height: "100%" }} />
        
        {/* 載入/錯誤 遮罩 */}
        {(loadingMsg || errorMsg) && (
          <div style={{ position: "absolute", top: 10, left: "50%", transform: "translateX(-50%)", background: errorMsg ? "rgba(255,230,230,0.95)" : "rgba(255,255,255,0.95)", border: errorMsg ? "1px solid #E07080" : "1px solid rgba(0,0,0,0.1)", padding: "6px 16px", borderRadius: "20px", fontSize: "0.8rem", zIndex: 10, boxShadow: "0 2px 10px rgba(0,0,0,0.1)", color: errorMsg ? "#E07080" : "var(--text)", fontWeight: "bold", whiteSpace: "nowrap" }}>
            {errorMsg || loadingMsg}
          </div>
        )}
      </div>

      {/* 底部操作區 */}
      <div style={{ padding: "1.2rem 1.5rem" }}>
        <p style={{ fontSize: "0.8rem", color: "var(--text-light)", marginBottom: "6px" }}>地址</p>
        <div style={{ display: "flex", gap: "8px", marginBottom: "1rem" }}>
          <input
            type="text"
            value={address}
            onChange={e => setAddress(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleSearch()}
            style={{ flex: 1, padding: "10px 14px", borderRadius: "12px", border: "1.5px solid rgba(0,0,0,0.1)", outline: "none", fontSize: "0.95rem", background: "rgba(255,255,255,0.8)" }}
            placeholder="輸入地址或直接拖曳地圖圖釘"
          />
          <button className="btn-secondary" onClick={handleSearch} style={{ padding: "10px 14px", borderRadius: "12px" }}>
            🔍
          </button>
        </div>

        <button 
          className="btn-primary" 
          disabled={!currentLoc}
          onClick={() => currentLoc && onConfirm({ ...currentLoc, label: `📍 ${address || '自訂位置'}` })}
          style={{ width: "100%", padding: "14px", borderRadius: "16px", fontSize: "1.05rem", opacity: currentLoc ? 1 : 0.5, boxShadow: "0 4px 15px rgba(255,155,176,0.3)" }}
        >
          ✅ 確認這個定點
        </button>
      </div>
    </div>
  );
}
