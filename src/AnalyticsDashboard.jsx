import React, { useMemo, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Legend
} from "recharts";

const AnalyticsDashboard = ({ data }) => {
  const [selected, setSelected] = useState(null);

  if (!data || !data.results || data.rowsAnalyzed === 0) {
    return (
      <div style={{ padding: 16 }}>
        <div style={{ fontSize: 28 }}>⚠️</div>
        <h3>Данные не распознаны</h3>
        <p>Система не смогла найти колонку БИН/ИИН в вашем файле.</p>
        <button onClick={() => window.location.reload()}>Попробовать другой файл</button>
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
    <div style={{ padding: 16, display: "grid", gap: 16 }}>
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
        <div><b>Компаний в реестре:</b> {data.rowsAnalyzed}</div>
        <div><b>Выявлено связей:</b> {data.sharedIINCount}</div>
        <div><b>Высокий риск:</b> {highCount}</div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div style={{ minHeight: 260, border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
          <h4 style={{ marginTop: 0 }}>Распределение по уровню риска</h4>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie dataKey="value" data={charts.riskLevelCounts || []} nameKey="name" label />
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div style={{ minHeight: 260, border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
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

      {/* Быстрые списки для фин.отдела */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
            <h4 style={{ margin: 0 }}>Физические лица (ИИН)</h4>
            <button onClick={() => copyList(individuals)}>Скопировать</button>
          </div>
          <div style={{ maxHeight: 220, overflow: "auto", marginTop: 8 }}>
            <table width="100%" cellPadding="8" style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "1px solid #eee" }}>
                  <th>ИИН</th><th>ФИО</th>
                </tr>
              </thead>
              <tbody>
                {individuals.map((x, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #f3f3f3" }}>
                    <td>{x.id}</td>
                    <td>{x.name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
            <h4 style={{ margin: 0 }}>Юридические лица (БИН)</h4>
            <button onClick={() => copyList(legalEntities)}>Скопировать</button>
          </div>
          <div style={{ maxHeight: 220, overflow: "auto", marginTop: 8 }}>
            <table width="100%" cellPadding="8" style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "1px solid #eee" }}>
                  <th>БИН</th><th>Наименование</th>
                </tr>
              </thead>
              <tbody>
                {legalEntities.map((x, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #f3f3f3" }}>
                    <td>{x.id}</td>
                    <td>{x.name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Реестр общий */}
      <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
        <h4 style={{ marginTop: 0 }}>Реестр</h4>
        <div style={{ maxHeight: 320, overflow: "auto" }}>
          <table width="100%" cellPadding="8" style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid #eee" }}>
                <th>БИН/ИИН</th>
                <th>Имя/Наименование</th>
                <th>Скоринг</th>
                <th>Уровень</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {results.map((item, idx) => (
                <tr key={idx} style={{ borderBottom: "1px solid #f3f3f3" }}>
                  <td>{item.id}</td>
                  <td>{item.displayName}</td>
                  <td>{item.riskScore}%</td>
                  <td>{item.riskLevel}</td>
                  <td>
                    <button onClick={() => setSelected(item)}>ℹ️</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Детали */}
      <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
        {selected ? (
          <>
            <h4 style={{ marginTop: 0 }}>{selected.displayName}</h4>
            <div style={{ marginBottom: 8 }}>
              <b>ID:</b> {selected.id} &nbsp; | &nbsp;
              <b>Тип:</b> {selected.entityType} &nbsp; | &nbsp;
              <b>Risk:</b> {selected.riskScore}% ({selected.riskLevel})
            </div>
            <ul>
              {(selected.reasons || ["Причины не указаны."]).map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </>
        ) : (
          <div>Выберите строку для просмотра деталей</div>
        )}
      </div>
    </div>
  );
};

export default AnalyticsDashboard;