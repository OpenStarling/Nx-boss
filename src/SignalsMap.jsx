import React, { useEffect, useState } from "react";
import { MapPin } from "lucide-react";
import mapImage from "./kz.svg"; 

const REGION_POSITIONS = {
  "Западно-Казахстанская область": { top: "30%", left: "15%" },
  "Атырауская область": { top: "48%", left: "13%" },
  "Мангистауская область": { top: "68%", left: "10%" },
  "Актюбинская область": { top: "40%", left: "30%" },
  "Костанайская область": { top: "25%", left: "45%" },
  "Северо-Казахстанская область": { top: "15%", left: "55%" },
  "Акмолинская область": { top: "28%", left: "60%" },
  "город Астана": { top: "30%", left: "62%" },
  "Павлодарская область": { top: "25%", left: "73%" },
  "Карагандинская область": { top: "42%", left: "62%" },
  "Улытауская область": { top: "55%", left: "52%" },
  "Кызылординская область": { top: "68%", left: "42%" },
  "Туркестанская область": { top: "83%", left: "48%" },
  "город Шымкент": { top: "86%", left: "52%" },
  "Жамбылская область": { top: "82%", left: "60%" },
  "Алматинская область": { top: "75%", left: "75%" },
  "город Алматы": { top: "82%", left: "75%" },
  "область Жетісу": { top: "65%", left: "80%" },
  "область Абай": { top: "45%", left: "82%" },
  "Восточно-Казахстанская область": { top: "52%", left: "90%" }
};

export default function SignalsMap({ pollMs = 5000, selectedItem }) {
  const [signals, setSignals] = useState([]);

  useEffect(() => {
    const load = async () => {
      try {
        const r = await fetch("http://localhost:3001/api/signals");
        const j = await r.json();
        setSignals(Array.isArray(j?.signals) ? j.signals : []);
      } catch { setSignals([]); }
    };
    load();
    const t = setInterval(load, pollMs);
    return () => clearInterval(t);
  }, [pollMs]);

  const getSelectedPos = () => {
    if (!selectedItem) return null;
    const name = selectedItem.regionRu || selectedItem.districtRu || selectedItem.cityRu;
    return REGION_POSITIONS[name] || null;
  };

  const clientPos = getSelectedPos();

  return (
    <div style={{ position: "relative", backgroundColor: "#ffffff", padding: "30px", borderRadius: "20px" }}>
      <style>{`
        @keyframes pulse-red {
          0% { transform: translate(-50%, -50%) scale(1); box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.7); }
          70% { transform: translate(-50%, -50%) scale(1.2); box-shadow: 0 0 0 10px rgba(239, 68, 68, 0); }
          100% { transform: translate(-50%, -50%) scale(1); box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
        }
        @keyframes pulse-green {
          0% { transform: translate(-50%, -50%) scale(1); box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7); }
          70% { transform: translate(-50%, -50%) scale(1.2); box-shadow: 0 0 0 10px rgba(16, 185, 129, 0); }
          100% { transform: translate(-50%, -50%) scale(1); box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
        }
        @keyframes megaRadar {
          0% { width: 14px; height: 14px; opacity: 1; }
          100% { width: 80px; height: 80px; opacity: 0; }
        }
      `}</style>
      
      <div style={{ textAlign: 'center', marginBottom: '25px', color: '#718096', letterSpacing: '1.5px', fontSize: '11px', fontWeight: '700' }}>
        <MapPin size={14} color="#10b981" style={{ verticalAlign: 'middle', marginRight: 8 }} />
        LIVE GEOSPATIAL MONITORING
      </div>

      <div style={{ position: "relative", width: "100%", maxWidth: "850px", margin: "0 auto" }}>
        <img src={mapImage} alt="Map" style={{ width: "100%", opacity: 0.15, filter: 'grayscale(1)' }} />

        {signals.map((s) => {
          const pos = REGION_POSITIONS[s.id] || { top: "50%", left: "50%" };
          return (
            <div
              key={s.id}
              style={{
                position: "absolute",
                top: pos.top,
                left: pos.left,
                width: "12px",
                height: "12px",
                backgroundColor: s.level === "HIGH" ? "#ef4444" : "#10b981",
                borderRadius: "50%",
                border: "2px solid white",
                animation: s.level === "HIGH" ? "pulse-red 2s infinite" : "pulse-green 2s infinite",
                zIndex: 5,
                cursor: 'pointer'
              }}
              title={`${s.id}: ${s.count} alerts`}
            />
          );
        })}

        {clientPos && (
          <div style={{ position: "absolute", top: clientPos.top, left: clientPos.left, zIndex: 100 }}>
            <div style={{
              position: "absolute", border: "2px solid #d4af37", borderRadius: "50%",
              animation: "megaRadar 2s infinite", transform: "translate(-50%, -50%)"
            }} />
            <div style={{
              position: "absolute", border: "2px solid #d4af37", borderRadius: "50%",
              animation: "megaRadar 2s infinite 1s", transform: "translate(-50%, -50%)"
            }} />
            <div style={{
              width: "14px", height: "14px", backgroundColor: "#d4af37", borderRadius: "2px",
              transform: "translate(-50%, -50%) rotate(45deg)", border: "2px solid white",
              boxShadow: "0 0 15px rgba(212, 175, 55, 0.8)", position: "absolute"
            }} />
          </div>
        )}
      </div>
    </div>
  );
}