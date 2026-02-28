import React, { useState, useEffect } from "react";

const AnalyticsDashboard = ({ data }) => {
  const [selectedCompany, setSelectedCompany] = useState(null);
  const [iinInfo, setIinInfo] = useState(null);
  const [iinErr, setIinErr] = useState("");
  const [iinLoading, setIinLoading] = useState(false);

  // если бэкенд вернул 0 строк
  if (!data || data.rowsAnalyzed === 0) {
    return (
      <div className="no-data-alert">
        <div className="alert-icon">⚠️</div>
        <h3>Данные не распознаны</h3>
        <p>Система не смогла найти колонку <strong>"БИН"</strong> в вашем файле.</p>
        <button className="back-btn" onClick={() => window.location.reload()}>
          🔄 Попробовать другой файл
        </button>
      </div>
    );
  }

  const results = data.results || [];

  // ✅ Когда выбрали компанию — подтягиваем ИИН по БИН
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setIinErr("");
      setIinInfo(null);

      if (!selectedCompany) return;

      const bin = selectedCompany.bin || selectedCompany.id;
      if (!bin) return;

      setIinLoading(true);
      try {
        // ВАЖНО: относительный путь, чтобы работало как /api/analyze
        const r = await fetch(`/api/get-iin-by-bin?bin=${encodeURIComponent(bin)}`);
        let j = null;
        try { j = await r.json(); } catch {}

        if (!r.ok) throw new Error(`HTTP ${r.status}: ${JSON.stringify(j)}`);

        if (cancelled) return;
        setIinInfo({
          leaderIIN: j?.leaderIIN || null,
          foundersIINs: Array.isArray(j?.foundersIINs) ? j.foundersIINs : [],
        });
      } catch (e) {
        if (cancelled) return;
        setIinErr(String(e.message || e));
      } finally {
        if (!cancelled) setIinLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [selectedCompany]);

  return (
    <div className="dashboard-content">
      <div className="stats-grid">
        <div className="stat-card">
          <span className="stat-label">Компаний в реестре</span>
          <span className="stat-value">{data.rowsAnalyzed}</span>
        </div>
        <div className="stat-card warning">
          <span className="stat-label">Выявлено связей</span>
          <span className="stat-value">{data.sharedIINCount}</span>
        </div>
        <div className="stat-card danger">
          <span className="stat-label">Высокий риск</span>
          <span className="stat-value">
            {results.filter(r => r.riskLevel === "HIGH").length}
          </span>
        </div>
      </div>

      <div className="dashboard-main-grid">
        <div className="table-container">
          <table className="analysis-table">
            <thead>
              <tr>
                <th>БИН/ИИН</th>
                <th>Наименование</th>
                <th>ОКЭД</th>
                <th>Скоринг</th>
                <th>Уровень</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {results.map((item, idx) => (
                <tr
                  key={idx}
                  className={selectedCompany?.bin === item.bin ? "active-row" : ""}
                >
                  <td>{item.bin}</td>
                  <td>{item.name}</td>
                  <td>{item.oked ? `${item.oked} ${item.okedNameRu || ""}` : "—"}</td>
                  <td>{item.riskScore}%</td>
                  <td>
                    <span className={`badge ${String(item.riskLevel || "").toLowerCase()}`}>
                      {item.riskLevel}
                    </span>
                  </td>
                  <td>
                    <button onClick={() => setSelectedCompany(item)}>👁️</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="details-sidebar">
          {selectedCompany ? (
            <div className="details-card">
              <h4>{selectedCompany.name}</h4>

              <div style={{ margin: "10px 0", padding: 10, border: "1px solid #eee", borderRadius: 10 }}>
                <b>ИИН (по БИН из ГБД ЮЛ)</b>
                {iinLoading && <div>Загрузка...</div>}
                {!iinLoading && iinErr && <div style={{ color: "red" }}>{iinErr}</div>}
                {!iinLoading && !iinErr && (
                  <>
                    <div>Руководитель: <b>{iinInfo?.leaderIIN || "—"}</b></div>
                    <div>Учредители: <b>{(iinInfo?.foundersIINs || []).join(", ") || "—"}</b></div>
                  </>
                )}
              </div>

              <div className="risk-reasons">
                {(selectedCompany.reasons || []).map((r, i) => (
                  <div key={i} className="reason-item">🚩 {r}</div>
                ))}
              </div>
            </div>
          ) : (
            <div className="empty-state">Выберите компанию для анализа</div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AnalyticsDashboard;