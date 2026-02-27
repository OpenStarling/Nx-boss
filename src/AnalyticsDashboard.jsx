import React, { useMemo, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend
} from 'recharts';

const AnalyticsDashboard = ({ data }) => {
  const [selectedCompany, setSelectedCompany] = useState(null);

  if (!data || data.rowsAnalyzed === 0) {
    return (
      <div style={{ padding: 16 }}>
        <div style={{ fontSize: 28 }}>⚠️</div>
        <h3>Данные не распознаны</h3>
        <p>Система не смогла найти колонку "БИН" в вашем файле.</p>
        <h4>Как исправить:</h4>
        <ul>
          <li>Удалите лишние пустые строки в начале таблицы</li>
          <li>Убедитесь, что заголовок "БИН" находится в первой строке</li>
          <li>Проверьте, что БИН содержит 12 цифр</li>
        </ul>
        <button onClick={() => window.location.reload()}>Попробовать другой файл</button>
      </div>
    );
  }

  const results = data.results || [];
  const charts = data.charts || {};

  const highCount = useMemo(
    () => results.filter(r => r.riskLevel === 'HIGH').length,
    [results]
  );

  return (
    <div style={{ padding: 16, display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        <div><b>Компаний в реестре:</b> {data.rowsAnalyzed}</div>
        <div><b>Выявлено связей:</b> {data.sharedIINCount}</div>
        <div><b>Высокий риск:</b> {highCount}</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div style={{ minHeight: 260, border: '1px solid #eee', borderRadius: 12, padding: 12 }}>
          <h4 style={{ marginTop: 0 }}>Распределение по уровню риска</h4>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie dataKey="value" data={charts.riskLevelCounts || []} nameKey="name" label />
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div style={{ minHeight: 260, border: '1px solid #eee', borderRadius: 12, padding: 12 }}>
          <h4 style={{ marginTop: 0 }}>Гистограмма скоринга</h4>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={charts.scoreHistogram || []}>
              <XAxis dataKey="bucket" />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="count" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div style={{ border: '1px solid #eee', borderRadius: 12, padding: 12 }}>
        <h4 style={{ marginTop: 0 }}>Реестр</h4>
        <div style={{ maxHeight: 320, overflow: 'auto' }}>
          <table width="100%" cellPadding="8" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid #eee' }}>
                <th>БИН/ИИН</th>
                <th>Наименование</th>
                <th>Скоринг</th>
                <th>Уровень</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {results.map((item, idx) => (
                <tr key={idx} style={{ borderBottom: '1px solid #f3f3f3' }}>
                  <td>{item.bin}</td>
                  <td>{item.name}</td>
                  <td>{item.riskScore}%</td>
                  <td>{item.riskLevel}</td>
                  <td>
                    <button onClick={() => setSelectedCompany(item)}>
                      ℹ️
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ border: '1px solid #eee', borderRadius: 12, padding: 12 }}>
        {selectedCompany ? (
          <>
            <h4 style={{ marginTop: 0 }}>{selectedCompany.name}</h4>
            <div style={{ marginBottom: 8 }}>
              <b>BIN:</b> {selectedCompany.bin} &nbsp; | &nbsp;
              <b>Risk:</b> {selectedCompany.riskScore}% ({selectedCompany.riskLevel})
            </div>
            <ul>
              {(selectedCompany.reasons || ["Причины не указаны."]).map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </>
        ) : (
          <div>Выберите компанию для анализа</div>
        )}
      </div>
    </div>
  );
};

export default AnalyticsDashboard;