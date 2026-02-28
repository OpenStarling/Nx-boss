import React from "react";
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
  "город Алматы": { top: "78%", left: "68%" },
  "Алматинская область": { top: "75%", left: "70%" },
  "Жамбылская область": { top: "80%", left: "60%" },
  "Область Абай": { top: "40%", left: "80%" },
  "Восточно-Казахстанская область": { top: "50%", left: "85%" },
  "Область Жетысу": { top: "65%", left: "75%" },
};

const SignalsMap = ({ signals = [], selectedClient }) => {

  // Жестко задаем 4 разных региона для отображения связей, когда кликнули на клиента
  const networkRegions = [
    "город Астана", 
    "город Алматы", 
    "Атырауская область", 
    "Восточно-Казахстанская область"
  ];

  return (
    <div style={{ position: "relative", width: "100%", maxWidth: "800px", margin: "0 auto", padding: "20px" }}>
      <div style={{ position: "relative", width: "100%" }}>
        <img src={mapImage} alt="Map of Kazakhstan" style={{ width: "100%", height: "auto", opacity: 0.9 }} />

        {/* 1. РЕЖИМ ПО УМОЛЧАНИЮ: Клиент не выбран. Показываем тепловую карту рисков */}
        {!selectedClient && signals.map((s, index) => {
          const pos = REGION_POSITIONS[s.id];
          if (!pos) return null;
          
          const isHigh = s.level === "HIGH";
          const delay = index * 0.15;

          return (
            <div
              key={s.id}
              style={{
                position: "absolute", top: pos.top, left: pos.left,
                width: "14px", height: "14px",
                backgroundColor: isHigh ? "#ef4444" : "#10b981",
                borderRadius: "50%", border: "2px solid white",
                animation: `popIn 0.5s ease-out ${delay}s both, ${isHigh ? "pulse-red" : "pulse-green"} 2s infinite ${delay + 0.5}s`,
                zIndex: 5, transform: "translate(-50%, -50%)",
                boxShadow: "0 2px 4px rgba(0,0,0,0.3)"
              }}
              title={`${s.name || s.id}: ${s.count} объектов`}
            />
          );
        })}

        {/* 2. РЕЖИМ ВЫБРАННОГО КЛИЕНТА: Показываем 4 точки в разных регионах */}
        {selectedClient && networkRegions.map((regionName, idx) => {
          const pos = REGION_POSITIONS[regionName];
          if (!pos) return null;
          
          // Делаем небольшую задержку для каждой точки, чтобы они появлялись по очереди (эффектно!)
          const delay = idx * 0.2; 

          return (
            <div key={idx} style={{ 
              position: "absolute", top: pos.top, left: pos.left, zIndex: 100,
              animation: `popIn 0.4s ease-out ${delay}s both`
            }}>
              {/* Пульсирующие круги радара */}
              <div style={{
                position: "absolute", border: "2px solid #3b82f6", borderRadius: "50%",
                animation: `megaRadar 2s infinite ${delay}s`, transform: "translate(-50%, -50%)"
              }} />
              <div style={{
                position: "absolute", border: "2px solid #3b82f6", borderRadius: "50%",
                animation: `megaRadar 2s infinite ${delay + 1}s`, transform: "translate(-50%, -50%)"
              }} />
              
              {/* Сама точка */}
              <div style={{
                width: "16px", height: "16px", backgroundColor: "#2563eb", borderRadius: "50%",
                transform: "translate(-50%, -50%)", border: "3px solid white",
                boxShadow: "0 0 15px rgba(37, 99, 235, 0.8)", position: "relative", zIndex: 2
              }} title={`Связь: ${regionName}`} />
            </div>
          );
        })}

      </div>

      {/* Стили анимаций */}
      <style>{`
        @keyframes pulse-red {
          0% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.7); }
          70% { box-shadow: 0 0 0 10px rgba(239, 68, 68, 0); }
          100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
        }
        @keyframes pulse-green {
          0% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7); }
          70% { box-shadow: 0 0 0 10px rgba(16, 185, 129, 0); }
          100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
        }
        @keyframes megaRadar {
          0% { width: 0px; height: 0px; opacity: 1; }
          100% { width: 70px; height: 70px; opacity: 0; }
        }
        @keyframes popIn {
          0% { transform: scale(0); opacity: 0; }
          80% { transform: scale(1.3); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
};

export default SignalsMap;