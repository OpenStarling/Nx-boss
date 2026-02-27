import React, { useState } from "react";
import "./App.css";
import AnalyticsDashboard from "./AnalyticsDashboard";

function App() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [view, setView] = useState("home"); // home | scanning | result
  const [error, setError] = useState("");

  const handleAnalyze = async (e) => {
    e.preventDefault();
    setError("");

    const file = e.target?.file?.files?.[0];
    if (!file) {
      setError("Выберите Excel-файл (.xlsx) перед анализом.");
      return;
    }

    setLoading(true);
    setView("scanning");

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/analyze", { method: "POST", body: formData });

      // читаем body ОДИН раз
      const raw = await response.text();
      let payload = null;
      try { payload = raw ? JSON.parse(raw) : null; } catch {}

      if (!response.ok) {
        const detail = (payload && (payload.detail || payload.message)) || raw || `HTTP ${response.status}`;
        throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
      }

      if (!payload) throw new Error("Сервер вернул пустой ответ.");

      setData(payload);
      setView("result");
    } catch (err) {
      console.error(err);
      setError(`Ошибка сервера: ${String(err?.message || err)}`);
      setView("home");
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app">
      <main className="app-main">
        {view === "home" && (
          <div className="card">
            <h2>Загрузка реестра</h2>
            <p style={{ opacity: 0.8 }}>Загрузите Excel (.xlsx) с колонкой БИН/ИИН.</p>

            <form onSubmit={handleAnalyze} className="form">
              <input name="file" type="file" accept=".xlsx,.xls" disabled={loading} />
              <button type="submit" disabled={loading} className="btn">
                {loading ? "Анализируем..." : "Запустить анализ"}
              </button>
            </form>

            {error && <div className="error-box" style={{ marginTop: 12 }}>{error}</div>}
          </div>
        )}

        {view === "scanning" && (
          <div className="card">
            <h2>Получаем имена через API…</h2>
            <p style={{ opacity: 0.8 }}>
              Если файл большой — первый раз может быть дольше. Повторно будет быстрее (кеш).
            </p>
            <div className="loader-wrap" style={{ marginTop: 18 }}>
              <div className="loader" />
            </div>
          </div>
        )}

        {view === "result" && <AnalyticsDashboard data={data} />}
      </main>
    </div>
  );
}

export default App;