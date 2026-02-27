import React, { useState } from 'react';

const AnalyticsDashboard = ({ data }) => {
  const [selectedCompany, setSelectedCompany] = useState(null);

  // Если бэкенд вернул 0 строк, показываем инструкцию по исправлению файла
  if (!data || data.rowsAnalyzed === 0) {
    return (
      <div className="no-data-alert">
        <div className="alert-icon">⚠️</div>
        <h3>Данные не распознаны</h3>
        <p>Система не смогла найти колонку <strong>"БИН"</strong> в вашем файле.</p>
        <div className="instructions">
          <h4>Как исправить:</h4>
          <ul>
            <li>Удалите лишние пустые строки в начале таблицы</li>
            <li>Убедитесь, что заголовок "БИН" находится в первой строке данных</li>
            <li>Проверьте, что БИН содержит 12 цифр</li>
          </ul>
        </div>
        <button className="back-btn" onClick={() => window.location.reload()}>
          🔄 Попробовать другой файл
        </button>
      </div>
    );
  }

  const results = data.results || [];

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
            {results.filter(r => r.riskLevel === 'HIGH').length}
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
                <th>Скоринг</th>
                <th>Уровень</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {results.map((item, idx) => (
                <tr key={idx} className={selectedCompany?.bin === item.bin ? 'active-row' : ''}>
                  <td>{item.bin}</td>
                  <td>{item.name}</td>
                  <td>{item.riskScore}%</td>
                  <td>
                    <span className={`badge ${item.riskLevel.toLowerCase()}`}>
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
              <div className="risk-reasons">
                {selectedCompany.reasons.map((r, i) => (
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