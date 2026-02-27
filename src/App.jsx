import React, { useState, useEffect } from 'react';
import './App.css';
import AnalyticsDashboard from "./AnalyticsDashboard";

function App() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [view, setView] = useState('home');
  const [file, setFile] = useState(null);
  const [statusIndex, setStatusIndex] = useState(0);

  // Список статусов для создания "эффекта работы"
  const statuses = [
    "Подключение к шлюзу ГБД ЮЛ...",
    "Извлечение БИН из реестра...",
    "Поиск связей через ИИН учредителей...",
    "Запуск DeepSeek R1 для оценки рисков...",
    "Формирование графа аффилированности...",
    "Почти готово, упаковываем данные..."
  ];

  useEffect(() => {
    let interval;
    if (loading) {
      interval = setInterval(() => {
        setStatusIndex((prev) => (prev + 1) % statuses.length);
      }, 2500);
    } else {
      setStatusIndex(0);
    }
    return () => clearInterval(interval);
  }, [loading]);

  const handleAnalyze = async (e) => {
    e.preventDefault();
    if (!file) {
      alert("Выберите Excel файл!");
      return;
    }

    setLoading(true);
    setView('scanning');

    const formData = new FormData();
    formData.append("file", file); 

    try {
      const response = await fetch('http://localhost:3001/api/analyze', {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();

      if (!response.ok) {
        alert(result.detail || result.error || "Ошибка анализа");
        setView('home');
        return;
      }

      setData(result);
      setView('result');

    } catch (err) {
      console.error("Connection error:", err);
      alert("Ошибка сервера. Убедись, что Python-бэкенд запущен!");
      setView('home');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app-container">
      <nav className="sidebar">
        <div className="logo">NX-BOSS <span>AI</span></div>
        <ul className="nav-links">
          <li className={view === 'home' ? 'active' : ''} onClick={() => setView('home')}>
            📂 Загрузка реестра
          </li>
          <li>📊 Мои Реестры</li>
          <li>📜 История аудита</li>
          <li>⚙️ Настройки</li>
        </ul>
        <div className="sidebar-footer">
          <p>Версия: 2.0.0 (DeepSeek 8b + GBDUL)</p>
        </div>
      </nav>

      <main className="main-content">
        {view === 'home' && (
          <div className="hero-section">
            <h1>ИИ-аудит реестра заемщиков</h1>
            <p>Загрузите Excel файл для автоматической проверки аффилированности</p>

            <form className="search-box" onSubmit={handleAnalyze}>
              <div className="file-input-wrapper">
                <input
                  type="file"
                  id="file-upload"
                  accept=".xlsx,.xls"
                  onChange={(e) => setFile(e.target.files[0])}
                  required
                />
                <label htmlFor="file-upload" className="file-label">
                  {file ? `✅ ${file.name}` : "Выбрать файл Excel"}
                </label>
              </div>
              <button type="submit" className="analyze-btn" disabled={!file || loading}>
                {loading ? "Анализируем..." : "Запустить анализ"}
              </button>
            </form>

            <div className="features-grid">
              <div className="f-card">📊 <span>Авто-скоринг</span></div>
              <div className="f-card">🕸️ <span>Граф связей</span></div>
              <div className="f-card">🧠 <span>ИИ объяснение</span></div>
            </div>
          </div>
        )}

        {view === 'scanning' && (
          <div className="scanning-screen">
            <div className="scanner-circle"></div>
            <div className="scanner-text">
              <h2>{statuses[statusIndex]}</h2>
              <p>Опрашиваем ГБД ЮЛ и строим граф связей</p>
            </div>
            <div className="progress-bar-container">
              <div className="progress-bar-fill"></div>
            </div>
          </div>
        )}

        {view === 'result' && data && (
          <div className="result-view">
            <div className="result-header">
               <button className="back-btn" onClick={() => { setView('home'); setFile(null); }}>
                ← Назад к загрузке
              </button>
              <div className="quick-stats">
                <div className="stat-pill">Компаний: <strong>{data.rowsAnalyzed}</strong></div>
                <div className="stat-pill">Связей: <strong>{data.sharedIINCount}</strong></div>
              </div>
            </div>
            <AnalyticsDashboard data={data} />
          </div>
        )}
      </main>
    </div>
  );
}

export default App;