import React, { useMemo, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Legend
} from "recharts";

const AnalyticsDashboard = ({ data }) => {
  const [selected, setSelected] = useState(null);

  // Внедряем CSS-переменные для автоматической смены светлой/темной темы
  // и базовые правила для красивых таблиц и кнопок, не меняя структуру компонентов.
  const themeStyles = `
    .analytics-root {
      --bg-color: #ffffff;
      --card-bg: #ffffff;
      --text-main: #0f172a;
      --text-muted: #64748b;
      --border-color: #e2e8f0;
      --shadow-sm: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -2px rgba(0, 0, 0, 0.05);
      --row-hover: #f8fafc;
      --primary: #3b82f6;
      --radius: 16px;
      
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      color: var(--text-main);
      line-height: 1.5;
    }

    @media (prefers-color-scheme: dark) {
      .analytics-root {
        --bg-color: #0f172a;
        --card-bg: #1e293b;
        --text-main: #f8fafc;
        --text-muted: #94a3b8;
        --border-color: #334155;
        --shadow-sm: 0 10px 15px -3px rgba(0, 0, 0, 0.3);
        --row-hover: #334155;
        --primary: #60a5fa;
      }
      /* Адаптация текстов внутри графиков recharts под темную тему */
      .recharts-text { fill: var(--text-muted) !important; }
      .recharts-tooltip-wrapper .recharts-default-tooltip { 
        background-color: var(--card-bg) !important; 
        border-color: var(--border-color) !important;
        color: var(--text-main) !important;
      }
    }

    .base-card {
      background: var(--card-bg);
      border: 1px solid var(--border-color);
      box-shadow: var(--shadow-sm);
      border-radius: var(--radius);
      padding: 20px;
      transition: all 0.3s ease;
    }

    .base-btn {
      background: var(--primary);
      color: #ffffff;
      border: none;
      padding: 6px 14px;
      border-radius: 8px;
      font-weight: 500;
      cursor: pointer;
      font-size: 14px;
      transition: opacity 0.2s, transform 0.1s;
    }
    .base-btn:hover { opacity: 0.9; transform: translateY(-1px); }
    .base-btn:active { transform: translateY(0); }

    .base-table th { color: var(--text-muted); font-weight: 600; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; }
    .base-table tr { border-bottom: 1px solid var(--border-color); transition: background 0.2s; }
    .base-table tbody tr:hover { background: var(--row-hover); }
    .base-table td { font-size: 14px; }
  `;

  if (!data || !data.results || data.rowsAnalyzed === 0) {
    return (
      <div className="analytics-root" style={{ padding: 40, textAlign: "center", background: "var(--card-bg)", borderRadius: "var(--radius)", border: "1px dashed var(--border-color)" }}>
        <style>{themeStyles}</style>
        <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
        <h3 style={{ margin: "0 0 8px 0", fontSize: 24 }}>Данные не распознаны</h3>
        <p style={{ color: "var(--text-muted)", marginBottom: 24 }}>Система не смогла найти колонку БИН/ИИН в вашем файле.</p>
        <button className="base-btn" style={{ padding: "10px 20px" }} onClick={() => window.location.reload()}>Попробовать другой файл</button>
      </div>
    );
  }

  const results = data.results || [];
  const charts = data.charts || {};
  const individuals = data.individuals || [];
  const legalEntities = data.legalEntities || [];

  const highCount = useMemo(
    () => results.filter(r => r.riskLevel === "HIGH").length,
    [results]
  );

  const copyList = (items) => {
    const text = items.map(x => `${x.id}\t${x.name}`).join("\n");
    navigator.clipboard.writeText(text);
    alert("Скопировано (ID + Имя). Можно вставлять в Excel.");
  };

  return (
    <div className="analytics-root" style={{ padding: "24px", display: "grid", gap: "24px", background: "var(--bg-color)", minHeight: "100vh" }}>
      <style>{themeStyles}</style>

      {/* Верхняя панель со статистикой */}
      <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
        <div className="base-card" style={{ flex: 1, minWidth: 200, padding: 16 }}>
          <div style={{ color: "var(--text-muted)", fontSize: 13, textTransform: "uppercase", fontWeight: 600 }}>Компаний в реестре</div>
          <div style={{ fontSize: 28, fontWeight: 700, marginTop: 4 }}>{data.rowsAnalyzed}</div>
        </div>
        <div className="base-card" style={{ flex: 1, minWidth: 200, padding: 16 }}>
          <div style={{ color: "var(--text-muted)", fontSize: 13, textTransform: "uppercase", fontWeight: 600 }}>Выявлено связей</div>
          <div style={{ fontSize: 28, fontWeight: 700, marginTop: 4 }}>{data.sharedIINCount}</div>
        </div>
        <div className="base-card" style={{ flex: 1, minWidth: 200, padding: 16, borderLeft: "4px solid #ef4444" }}>
          <div style={{ color: "var(--text-muted)", fontSize: 13, textTransform: "uppercase", fontWeight: 600 }}>Высокий риск</div>
          <div style={{ fontSize: 28, fontWeight: 700, marginTop: 4, color: "#ef4444" }}>{highCount}</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(400px, 1fr))", gap: 24 }}>
        <div className="base-card" style={{ minHeight: 280 }}>
          <h4 style={{ margin: "0 0 20px 0", fontSize: 18 }}>Распределение по уровню риска</h4>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie dataKey="value" data={charts.riskLevelCounts || []} nameKey="name" label stroke="var(--card-bg)" strokeWidth={2} />
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="base-card" style={{ minHeight: 280 }}>
          <h4 style={{ margin: "0 0 20px 0", fontSize: 18 }}>Гистограмма скоринга</h4>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={charts.scoreHistogram || []}>
              <XAxis dataKey="bucket" axisLine={false} tickLine={false} />
              <YAxis allowDecimals={false} axisLine={false} tickLine={false} />
              <Tooltip cursor={{ fill: 'var(--row-hover)' }} />
              <Bar dataKey="count" fill="var(--primary)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Быстрые списки для фин.отдела */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(400px, 1fr))", gap: 24 }}>
        <div className="base-card" style={{ padding: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "16px 20px", display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", borderBottom: "1px solid var(--border-color)", background: "var(--row-hover)" }}>
            <h4 style={{ margin: 0 }}>Физические лица (ИИН)</h4>
            <button className="base-btn" onClick={() => copyList(individuals)}>Скопировать</button>
          </div>
          <div style={{ maxHeight: 250, overflow: "auto", padding: "0 20px 20px 20px" }}>
            <table className="base-table" width="100%" cellPadding="12" style={{ borderCollapse: "collapse" }}>
              <thead style={{ position: "sticky", top: 0, background: "var(--card-bg)" }}>
                <tr style={{ textAlign: "left" }}>
                  <th>ИИН</th><th>ФИО</th>
                </tr>
              </thead>
              <tbody>
                {individuals.map((x, i) => (
                  <tr key={i}>
                    <td style={{ fontFamily: "monospace", color: "var(--text-muted)" }}>{x.id}</td>
                    <td style={{ fontWeight: 500 }}>{x.name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="base-card" style={{ padding: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "16px 20px", display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", borderBottom: "1px solid var(--border-color)", background: "var(--row-hover)" }}>
            <h4 style={{ margin: 0 }}>Юридические лица (БИН)</h4>
            <button className="base-btn" onClick={() => copyList(legalEntities)}>Скопировать</button>
          </div>
          <div style={{ maxHeight: 250, overflow: "auto", padding: "0 20px 20px 20px" }}>
            <table className="base-table" width="100%" cellPadding="12" style={{ borderCollapse: "collapse" }}>
              <thead style={{ position: "sticky", top: 0, background: "var(--card-bg)" }}>
                <tr style={{ textAlign: "left" }}>
                  <th>БИН</th><th>Наименование</th>
                </tr>
              </thead>
              <tbody>
                {legalEntities.map((x, i) => (
                  <tr key={i}>
                    <td style={{ fontFamily: "monospace", color: "var(--text-muted)" }}>{x.id}</td>
                    <td style={{ fontWeight: 500 }}>{x.name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Реестр общий */}
      <div className="base-card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "20px", borderBottom: "1px solid var(--border-color)", background: "var(--row-hover)" }}>
          <h4 style={{ margin: 0, fontSize: 18 }}>Общий Реестр</h4>
        </div>
        <div style={{ maxHeight: 400, overflow: "auto", padding: "0 20px 20px 20px" }}>
          <table className="base-table" width="100%" cellPadding="14" style={{ borderCollapse: "collapse" }}>
            <thead style={{ position: "sticky", top: 0, background: "var(--card-bg)", zIndex: 1 }}>
              <tr style={{ textAlign: "left" }}>
                <th>БИН/ИИН</th>
                <th>Имя/Наименование</th>
                <th>Скоринг</th>
                <th>Уровень</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {results.map((item, idx) => (
                <tr key={idx}>
                  <td style={{ fontFamily: "monospace", color: "var(--text-muted)" }}>{item.id}</td>
                  <td style={{ fontWeight: 500 }}>{item.displayName}</td>
                  <td style={{ fontWeight: 600 }}>{item.riskScore}%</td>
                  <td>
                    <span style={{
                      padding: "4px 10px", 
                      borderRadius: "20px", 
                      fontSize: 12, 
                      fontWeight: 700,
                      backgroundColor: item.riskLevel === 'HIGH' ? '#fef2f2' : item.riskLevel === 'MEDIUM' ? '#fffbeb' : '#f0fdf4',
                      color: item.riskLevel === 'HIGH' ? '#dc2626' : item.riskLevel === 'MEDIUM' ? '#d97706' : '#16a34a',
                      border: `1px solid ${item.riskLevel === 'HIGH' ? '#fca5a5' : item.riskLevel === 'MEDIUM' ? '#fcd34d' : '#86efac'}`
                    }}>
                      {item.riskLevel}
                    </span>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <button className="base-btn" style={{ background: "transparent", color: "var(--primary)", border: "1px solid var(--primary)" }} onClick={() => setSelected(item)}>
                      Инфо
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Детали */}
      <div className="base-card" style={{ marginTop: 8, borderLeft: selected ? "4px solid var(--primary)" : "1px solid var(--border-color)" }}>
        {selected ? (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
              <h4 style={{ margin: 0, fontSize: 20 }}>{selected.displayName}</h4>
              <button className="base-btn" style={{ background: "transparent", color: "var(--text-muted)", fontSize: 20, padding: "0 8px" }} onClick={() => setSelected(null)}>×</button>
            </div>
            
            <div style={{ display: "flex", gap: 24, marginBottom: 20, padding: "12px 16px", background: "var(--row-hover)", borderRadius: 8 }}>
              <div><span style={{ color: "var(--text-muted)", fontSize: 12, textTransform: "uppercase", display: "block" }}>ID</span> <b>{selected.id}</b></div>
              <div><span style={{ color: "var(--text-muted)", fontSize: 12, textTransform: "uppercase", display: "block" }}>Тип</span> <b>{selected.entityType}</b></div>
              <div><span style={{ color: "var(--text-muted)", fontSize: 12, textTransform: "uppercase", display: "block" }}>Risk Score</span> <b style={{ color: selected.riskLevel === 'HIGH' ? '#dc2626' : 'inherit' }}>{selected.riskScore}% ({selected.riskLevel})</b></div>
            </div>
            
            <h5 style={{ margin: "0 0 12px 0", fontSize: 14, color: "var(--text-muted)", textTransform: "uppercase" }}>Факторы риска:</h5>
            <ul style={{ margin: 0, paddingLeft: 20, color: "var(--text-main)", display: "flex", flexDirection: "column", gap: 8 }}>
              {(selected.reasons || ["Причины не указаны."]).map((r, i) => (
                <li key={i} style={{ padding: "8px 12px", background: "rgba(239, 68, 68, 0.05)", borderRadius: 6, borderLeft: "3px solid #ef4444" }}>{r}</li>
              ))}
            </ul>
          </>
        ) : (
          <div style={{ color: "var(--text-muted)", textAlign: "center", padding: "40px 0" }}>
            <div style={{ fontSize: 32, opacity: 0.5, marginBottom: 8 }}>👆</div>
            Выберите строку в таблице для просмотра деталей
          </div>
        )}
      </div>
    </div>
  );
};

export default AnalyticsDashboard;