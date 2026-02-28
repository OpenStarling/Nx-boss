import React, { useState } from "react";
import "./App.css";
import AnalyticsDashboard from "./AnalyticsDashboard";
import { FileUp, Search, Loader2 } from "lucide-react";

function App() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [view, setView] = useState("home"); // home | result
  const [error, setError] = useState("");

  const handleAnalyze = async (e) => {
    e.preventDefault();
    setError("");

    const file = e.target?.file?.files?.[0];
    if (!file) {
      setError("Пожалуйста, выберите файл .xlsx");
      return;
    }

    setLoading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/analyze", { method: "POST", body: formData });
      const payload = await response.json();

      console.log("📦 ПОЛНЫЙ ОТВЕТ ОТ БЭКЕНДА:", payload);

      if (!response.ok) {
        throw new Error(payload.detail || "Ошибка сервера");
      }

      setData(payload);
      setView("result");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app-container">
      {view === "home" ? (
        <div className="welcome-card">
          <div style={{ 
            width: 60, height: 60, background: '#f0fdf4', 
            borderRadius: '50%', display: 'flex', 
            alignItems: 'center', justifyContent: 'center', 
            margin: '0 auto 20px', color: '#10b981'
          }}>
            <FileUp size={32} />
          </div>
          
          <h2>оптимизация процесса отбора заемщиков польготному  <span style={{color: '#d4af37'}}>финансированию</span></h2>
          <p>Загрузите реестр контрагентов в формате Excel для глубокого AML-анализа</p>

          <form onSubmit={handleAnalyze}>
            <input 
              name="file" 
              type="file" 
              accept=".xlsx,.xls" 
              className="file-upload-input"
              disabled={loading} 
            />
            
            <button type="submit" className="btn-start" disabled={loading}>
              {loading ? (
                <span style={{display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10}}>
                  <Loader2 className="animate-spin" size={20} /> Анализ данных...
                </span>
              ) : "Запустить мониторинг"}
            </button>
          </form>

          {error && <div className="error-msg">{error}</div>}
          
          <div style={{marginTop: 30, fontSize: 11, color: '#cbd5e1', letterSpacing: 1}}>
            SECURE CLOUD PROCESSING
          </div>
        </div>
      ) : (
        <AnalyticsDashboard data={data} />
      )}
    </div>
  );
}

export default App;