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

      // ВАЖНО: относительный путь, работает через Vite proxy -> http://127.0.0.1:8000
      const response = await fetch("/api/analyze", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        // попробуем прочитать текст/JSON ошибки
        let detail = "";
        try {
          const maybeJson = await response.json();
          detail = maybeJson?.detail ? String(maybeJson.detail) : JSON.stringify(maybeJson);
        } catch {
          detail = await response.text();
        }
        throw new Error(detail || `HTTP ${response.status}`);
      }

      const result = await response.json();

      setData(result);
      setView("result");
    } catch (err) {
      console.error(err);

      // дружелюбная ошибка для пользователя
      const msg = String(err?.message || "");
      setError(
        msg.includes("Failed to fetch")
          ? "Не удалось подключиться к серверу. Убедись, что Python-бэкенд запущен (uvicorn на 8000) и Vite proxy настроен."
          : `Ошибка сервера: ${msg}`
      );

      setView("home");
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <div className="brand-title">NX-BOSS</div>
          <div className="brand-tag">AI</div>
        </div>
      </header>

      <main className="app-main">
        {view === "home" && (
          <div className="card">
            <h2>Загрузка реестра</h2>
            <p style={{ opacity: 0.8 }}>
              Загрузите Excel (.xlsx) с колонкой <b>БИН</b> / <b>BIN</b>.
            </p>

            <form onSubmit={handleAnalyze} className="form">
              <input
                name="file"
                type="file"
                accept=".xlsx,.xls"
                disabled={loading}
                style={{ marginBottom: 12 }}
              />

              <button type="submit" disabled={loading} className="btn">
                {loading ? "Анализируем..." : "Запустить анализ"}
              </button>
            </form>

            {error && (
              <div className="error-box" style={{ marginTop: 12 }}>
                {error}
              </div>
            )}

            <div style={{ marginTop: 12, fontSize: 12, opacity: 0.7 }}>
              Если появляется ошибка подключения — проверь, что запущено:
              <div style={{ marginTop: 6 }}>
                <code>uvicorn app:app --reload --port 8000</code>
              </div>
              и в <code>vite.config.js</code> настроен proxy на <code>http://127.0.0.1:8000</code>.
            </div>
          </div>
        )}

        {view === "scanning" && (
          <div className="card">
            <h2>Подключение к Python API…</h2>
            <p style={{ opacity: 0.8 }}>
              Загружаем файл и строим аналитику по всем BIN.
            </p>

            <div className="loader-wrap" style={{ marginTop: 18 }}>
              <div className="loader" />
            </div>

            {error && (
              <div className="error-box" style={{ marginTop: 12 }}>
                {error}
              </div>
            )}
          </div>
        )}

        {view === "result" && <AnalyticsDashboard data={data} />}
      </main>
    </div>
  );
}

export default App;