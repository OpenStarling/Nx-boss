import React, { useState, useMemo, useEffect } from "react";
import {
  LayoutDashboard, ShieldAlert, Users, Download, Copy, ChevronRight,
  PieChart as PieIcon, Fingerprint, Building2, Sparkles, Loader2, Bot, Globe,
} from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import html2pdf from "html2pdf.js";
import SignalsMap from "./SignalsMap";
import "./Dashboard.css";

const dict = {
  ru: {
    dash: "Дашборд", db: "База субъектов", ai: "AI Анализ", export: "Экспорт PDF", riskStruct: "Структура рисков",
    high: "Высокий", med: "Средний", low: "Низкий", total: "ВСЕГО ОБЪЕКТОВ", totalSum: "ОБЩАЯ СУММА (₸)", critRisk: "КРИТИЧЕСКИЙ РИСК", medRisk: "СРЕДНИЙ РИСК", links: "СВЯЗИ ИИН",
    registry: "Реестр высокого риска", name: "Наименование", sumTable: "Сумма (₸)", status: "Статус", region: "Регион", oked: "ОКЭД / Отрасль", action: "Действие",
    indiv: "Физ. лица (ИИН)", entities: "Юр. лица (БИН)", aiTitle: "Локальный AI Анализ", genBtn: "Сгенерировать анализ",
    close: "Закрыть", score: "ОЦЕНКА РИСКА", factors: "Выявленные факторы риска:", wait: "Ожидание системы...", promptLang: "Отвечай строго на русском языке.",
    iinBlockTitle: "Связанные лица (ИИН)", leaderIIN: "Руководитель (ИИН)", foundersIINs: "Учредители (ИИН)", iinEmpty: "ИИН не найден (или это ФЛ).",
    extraData: "Дополнительные данные", sourceLeader: "Руководитель", sourceFounder: "Учредитель"
  },
  kz: {
    dash: "Басқару тақтасы", db: "Субъектілер базасы", ai: "AI Талдау", export: "PDF жүктеу", riskStruct: "Тәуекелдер құрылымы",
    high: "Жоғары", med: "Орташа", low: "Төмен", total: "БАРЛЫҚ НЫСАНДАР", totalSum: "ЖАЛПЫ СОМА (₸)", critRisk: "КРИТИКАЛЫҚ ТӘУЕКЕЛ", medRisk: "ОРТАША ТӘУЕКЕЛ", links: "ЖСН БАЙЛАНЫСТАРЫ",
    registry: "Жоғары тәуекел тізілімі", name: "Атауы", sumTable: "Сомасы (₸)", status: "Мәртебесі", region: "Аймақ", oked: "ЭҚЖЖ / Сала", action: "Әрекет",
    indiv: "Жеке тұлғалар (ЖСН)", entities: "Заңды тұлғалар (БСН)", aiTitle: "Жергілікті AI Талдау", genBtn: "Талдау жасау",
    close: "Жабу", score: "ТӘУЕКЕЛДІ БАҒАЛАУ", factors: "Анықталған тәуекел факторлары:", wait: "Жүйені күту...", promptLang: "Отвечай строго на казахском языке.",
    iinBlockTitle: "Байланысты тұлғалар (ЖСН)", leaderIIN: "Басшы (ЖСН)", foundersIINs: "Құрылтайшылар (ЖСН)", iinEmpty: "ЖСН табылмады.",
    extraData: "Қосымша деректер", sourceLeader: "Басшы", sourceFounder: "Құрылтайшы"
  }
};

const extractId = (obj) => obj?.id || obj?.bin || obj?.iin || "—";
const extractOked = (obj) => obj?.oked || obj?.okedNameRu || obj?.okedName || "—";

// =========================================================================
// ФУНКЦИИ ИЗВЛЕЧЕНИЯ И ФОРМАТИРОВАНИЯ ДЕНЕГ
// =========================================================================
const extractSum = (obj) => {
  if (!obj?.rowData) return 0;
  // Ищем колонку с суммами в сырых данных Excel
  const sumKey = Object.keys(obj.rowData).find(k => 
    k.toLowerCase().includes("сумма лимита") || 
    k.toLowerCase().includes("сумма гарантии") ||
    k.toLowerCase().includes("сумма займа")
  );
  if (sumKey && obj.rowData[sumKey]) {
    // Убираем пробелы (например, "120 000 000") и парсим число
    const valStr = String(obj.rowData[sumKey]).replace(/\s/g, "");
    const val = parseFloat(valStr);
    return isNaN(val) ? 0 : val;
  }
  return 0;
};

const formatCurrency = (val) => {
  if (!val) return "0";
  return new Intl.NumberFormat("ru-RU").format(val);
};

const AnalyticsDashboard = ({ data }) => {
  const [activeTab, setActiveTab] = useState("overview");
  const [selected, setSelected] = useState(null);
  const [lang, setLang] = useState("ru");
  const [aiResponse, setAiResponse] = useState("");
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [sortConfig, setSortConfig] = useState({ key: null, direction: "asc" });
  
  const [signalsData, setSignalsData] = useState([]);
  const t = dict[lang];

  useEffect(() => {
    const fetchSignals = async () => {
      try {
        const res = await fetch("http://localhost:8000/api/signals"); 
        if (res.ok) {
          const json = await res.json();
          setSignalsData(Array.isArray(json?.signals) ? json.signals : []);
        }
      } catch (e) {
        setSignalsData([]);
      }
    };
    fetchSignals();
    const iv = setInterval(fetchSignals, 5000);
    return () => clearInterval(iv);
  }, []);

  const derivedIndividuals = useMemo(() => {
    const iinMap = new Map();
    const findDeepIINs = (obj, companyName) => {
      if (!obj) return;
      if (typeof obj === 'object') {
        if (Array.isArray(obj)) {
          obj.forEach(item => findDeepIINs(item, companyName));
        } else {
          if (obj.IIN && typeof obj.IIN === 'string' && obj.IIN.length === 12) {
             if (!iinMap.has(obj.IIN)) iinMap.set(obj.IIN, `ГБД (${companyName})`);
          }
          Object.values(obj).forEach(val => findDeepIINs(val, companyName));
        }
      }
    };

    if (data?.individuals) {
      data.individuals.forEach(ind => iinMap.set(ind.id, ind.name));
    }
    
    if (data?.results) {
      data.results.forEach(item => {
        const compName = item.displayName || item.name || item.id || "Компания";
        if (item.leaderIIN && !iinMap.has(item.leaderIIN)) iinMap.set(item.leaderIIN, `${t.sourceLeader} (${compName})`);
        if (item.foundersIINs) {
          item.foundersIINs.forEach(iin => {
            if (iin && !iinMap.has(iin)) iinMap.set(iin, `${t.sourceFounder} (${compName})`);
          });
        }
        findDeepIINs(item, compName);
        if (item.rowData) {
          Object.entries(item.rowData).forEach(([key, val]) => {
            const strVal = String(val).replace(/\D/g, "");
            if (strVal.length === 12 && strVal !== item.id) {
               if (!iinMap.has(strVal)) iinMap.set(strVal, `Из файла: ${key} (${compName})`);
            }
          });
        }
      });
    }
    return Array.from(iinMap.entries()).map(([id, name]) => ({ id, name }));
  }, [data, t]);

  const stats = useMemo(() => {
    const counts = { HIGH: 0, MEDIUM: 0, LOW: 0 };
    if (data?.results) data.results.forEach((item) => { counts[item.riskLevel || "LOW"] = (counts[item.riskLevel || "LOW"] || 0) + 1; });
    return [
      { name: t.high, value: counts.HIGH, color: "#ef4444" },
      { name: t.med, value: counts.MEDIUM, color: "#d4af37" },
      { name: t.low, value: counts.LOW, color: "#10b981" }
    ];
  }, [data, t]);

  // СЧИТАЕМ ОБЩУЮ СУММУ ЛИМИТОВ
  const totalAmount = useMemo(() => {
    if (!data?.results) return 0;
    return data.results.reduce((acc, curr) => acc + extractSum(curr), 0);
  }, [data]);

  const sortedResults = useMemo(() => {
    if (!data?.results) return [];
    let items = [...data.results];
    if (sortConfig.key) {
      items.sort((a, b) => {
        let aVal, bVal;
        if (sortConfig.key === "sum") {
          aVal = extractSum(a);
          bVal = extractSum(b);
        } else {
          aVal = sortConfig.key === "id" ? extractId(a) : sortConfig.key === "name" ? (a.displayName || a.name || "") : sortConfig.key === "oked" ? extractOked(a) : String(a[sortConfig.key] || "");
          bVal = sortConfig.key === "id" ? extractId(b) : sortConfig.key === "name" ? (b.displayName || b.name || "") : sortConfig.key === "oked" ? extractOked(b) : String(b[sortConfig.key] || "");
        }
        return aVal < bVal ? (sortConfig.direction === "asc" ? -1 : 1) : aVal > bVal ? (sortConfig.direction === "asc" ? 1 : -1) : 0;
      });
    }
    return items;
  }, [data, sortConfig]);

  const requestSort = (key) => setSortConfig({ key, direction: sortConfig.key === key && sortConfig.direction === "asc" ? "desc" : "asc" });
  const copyToClipboard = (text) => navigator.clipboard.writeText(text);

  const exportPDF = () => {
    html2pdf().from(document.getElementById("pdf-area")).set({
      margin: 10, filename: "GreenGuard_Report.pdf", html2canvas: { scale: 2 }, jsPDF: { orientation: "landscape", format: "a3" }
    }).save();
  };

  const generateAISummary = async () => {
    setIsAiLoading(true); setAiResponse("");
    const prompt = `Act as an AML officer. Analyze: ${data?.rowsAnalyzed || 0} objects, ${stats[0].value} high risk. Provide summary. ${t.promptLang}`;
    try {
      const res = await fetch("http://localhost:11434/api/generate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "deepseek-r1:8b", prompt, stream: true })
      });
      const reader = res.body.getReader(); const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        decoder.decode(value).split("\n").filter(Boolean).forEach(line => setAiResponse((p) => p + JSON.parse(line).response));
      }
    } catch { setAiResponse("Connection to AI failed."); } finally { setIsAiLoading(false); }
  };

  return (
    <div className="dashboard-wrapper">
      <header className="main-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", padding: "0 40px" }}>
        <div className="logo-container">
          <div className="logo-box">G</div><div className="logo-text">GreenGuard <span style={{ color: "#d4af37" }}>Intelligence</span></div>
        </div>
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <Globe size={18} color="#718096" />
          {["ru", "kz"].map(l => (
            <button key={l} onClick={() => setLang(l)} style={{ background: lang === l ? "#10b981" : "transparent", color: lang === l ? "#fff" : "#718096", border: "none", padding: "4px 8px", borderRadius: "6px", cursor: "pointer", fontWeight: "bold", textTransform: "uppercase" }}>{l}</button>
          ))}
        </div>
      </header>

      <div className="content-container">
        <nav className="tabs-nav">
          <button className={`tab-link ${activeTab === "overview" ? "active" : ""}`} onClick={() => setActiveTab("overview")}><LayoutDashboard size={18} /> {t.dash}</button>
          <button className={`tab-link ${activeTab === "database" ? "active" : ""}`} onClick={() => setActiveTab("database")}><Users size={18} /> {t.db}</button>
          <button className={`tab-link ${activeTab === "aisum" ? "active" : ""}`} onClick={() => setActiveTab("aisum")}><Sparkles size={18} color="#d4af37" /> {t.ai}</button>
        </nav>

        {activeTab === "overview" && (
          <div style={{ display: "flex", justifyContent: "center", marginBottom: "10px" }}>
            <button className="btn-main" onClick={exportPDF}><Download size={18} style={{ marginRight: 8 }} /> {t.export}</button>
          </div>
        )}

        <div id="pdf-area" style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
          {activeTab === "overview" && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "20px" }}>
                <div className="dash-card" style={{ padding: 0, overflow: "hidden" }}>
                  <SignalsMap signals={signalsData} selectedClient={selected} />
                </div>
                
                <div className="dash-card">
                  <h4 style={{ display: "flex", alignItems: "center", gap: 8 }}><PieIcon size={18} color="#10b981" /> {t.riskStruct}</h4>
                  <div style={{ height: "250px", width: "100%", minHeight: 1 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart><Pie data={stats} innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value">{stats.map((e, i) => <Cell key={i} fill={e.color} />)}</Pie><Tooltip /></PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div style={{ fontSize: "12px", marginTop: "10px" }}>
                    {stats.map((s) => (<div key={s.name} style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}><span>{s.name}</span><span style={{ fontWeight: 700, color: s.color }}>{s.value}</span></div>))}
                  </div>
                </div>
              </div>

              {/* ОБНОВЛЕННАЯ СЕТКА КАРТОЧЕК С ДОБАВЛЕНИЕМ "СУММЫ" */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "20px" }}>
                {[
                  { title: t.total, val: data?.rowsAnalyzed || 0, color: "#2d3748", border: "" },
                  { title: t.totalSum, val: formatCurrency(totalAmount), color: "#3b82f6", border: "#3b82f6", isMoney: true },
                  { title: t.critRisk, val: data?.results?.filter((r) => r.riskLevel === "HIGH").length || 0, color: "#ef4444", border: "#ef4444" },
                  { title: t.medRisk, val: data?.results?.filter((r) => r.riskLevel === "MEDIUM").length || 0, color: "#d4af37", border: "#d4af37" },
                  { title: t.links, val: derivedIndividuals.length || 0, color: "#10b981", border: "" }
                ].map((s, i) => (
                  <div key={i} className="dash-card" style={{ borderBottom: s.border ? `4px solid ${s.border}` : "none", display: "flex", flexDirection: "column", justifyContent: "center" }}>
                    <div style={{ color: s.color, fontSize: "11px", fontWeight: 700 }}>{s.title}</div>
                    <div style={{ fontSize: s.isMoney ? "18px" : "28px", fontWeight: 800, marginTop: "4px" }}>{s.val}</div>
                  </div>
                ))}
              </div>

              <div className="dash-card">
                <h4 style={{ marginBottom: 20, display: "flex", alignItems: "center", gap: 10 }}><ShieldAlert color="#10b981" /> {t.registry}</h4>
                <div style={{ overflowX: "auto" }}>
                  <table className="clean-table" style={{ minWidth: "900px" }}>
                    <thead>
                      <tr>
                        {/* ДОБАВЛЕНА КОЛОНКА "СУММА" */}
                        {[{ k: "id", l: "БИН / ЖСН" }, { k: "name", l: t.name }, { k: "sum", l: t.sumTable }, { k: "riskLevel", l: t.status }, { k: "cityRu", l: t.region }, { k: "oked", l: t.oked }].map(c => (
                          <th key={c.k} onClick={() => requestSort(c.k)} style={{ cursor: "pointer", whiteSpace: "nowrap", userSelect: "none" }}>
                            {c.l} {sortConfig.key === c.k ? (sortConfig.direction === "asc" ? "↑" : "↓") : "↕"}
                          </th>
                        ))}
                        <th>{t.action}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedResults.map((item, idx) => {
                        const sumVal = extractSum(item);
                        return (
                        <tr key={idx} style={{ background: selected?.id === item.id ? "#f0fdf4" : "transparent" }}>
                          <td style={{ fontWeight: 700, fontFamily: "monospace" }}>{extractId(item)}</td>
                          <td>{item.displayName || item.name || "—"}</td>
                          {/* ВЫВОД СУММЫ */}
                          <td style={{ fontWeight: 600, color: "#3b82f6", whiteSpace: "nowrap" }}>
                            {sumVal > 0 ? formatCurrency(sumVal) : "—"}
                          </td>
                          <td><span className={`risk-badge ${item.riskLevel || "LOW"}`}>{item.riskLevel || "LOW"}</span></td>
                          <td>{item.cityRu || "—"}</td>
                          <td style={{ fontSize: "11px", maxWidth: "200px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={extractOked(item)}>{extractOked(item)}</td>
                          <td><button className="tab-link" onClick={() => setSelected(item)}><ChevronRight size={16} /></button></td>
                        </tr>
                      )})}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {activeTab === "database" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
              <div className="dash-card" style={{ borderTop: "4px solid #10b981" }}>
                <h4 style={{ display: "flex", alignItems: "center", gap: 10, color: "#10b981" }}><Fingerprint size={20} /> {t.indiv}</h4>
                <div style={{ maxHeight: "500px", overflowY: "auto" }}>
                  <table className="clean-table">
                    <thead><tr><th>ИИН / ЖСН</th><th>Источник</th><th></th></tr></thead>
                    <tbody>
                      {derivedIndividuals.length > 0 ? derivedIndividuals.map((x, i) => (
                        <tr key={i} style={{ animation: `popIn 0.3s ease-out ${i * 0.05}s both` }}>
                          <td style={{ fontSize: "12px", fontFamily: "monospace", fontWeight: 700 }}>{x.id}</td>
                          <td style={{ fontSize: "11px", color: "#475569" }}>{x.name}</td>
                          <td><button className="icon-btn" onClick={() => copyToClipboard(x.id)}><Copy size={14} /></button></td>
                        </tr>
                      )) : <tr><td colSpan="3" style={{ textAlign: "center", color: "#94a3b8", padding: "20px" }}>Физические лица не обнаружены</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="dash-card" style={{ borderTop: "4px solid #d4af37" }}>
                <h4 style={{ display: "flex", alignItems: "center", gap: 10, color: "#d4af37" }}><Building2 size={20} /> {t.entities}</h4>
                <div style={{ maxHeight: "500px", overflowY: "auto" }}>
                  <table className="clean-table">
                    <thead><tr><th>БИН / БСН</th><th>{t.name}</th><th></th></tr></thead>
                    <tbody>
                      {data?.legalEntities?.length > 0 ? data.legalEntities.map((x, i) => (
                        <tr key={i}>
                          <td style={{ fontSize: "12px", fontFamily: "monospace", fontWeight: 700 }}>{x.id}</td>
                          <td style={{ fontSize: "11px" }}>{x.name}</td>
                          <td><button className="icon-btn" onClick={() => copyToClipboard(x.id)}><Copy size={14} /></button></td>
                        </tr>
                      )) : <tr><td colSpan="3" style={{ textAlign: "center", color: "#94a3b8" }}>Юр. лица не найдены</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {activeTab === "aisum" && (
             <div className="dash-card" style={{ minHeight: "400px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                <h4 style={{ display: "flex", alignItems: "center", gap: 10, color: "#d4af37" }}><Bot size={24} /> {t.aiTitle}</h4>
                <button className="btn-main" onClick={generateAISummary} disabled={isAiLoading} style={{ background: "#2d3748" }}>{isAiLoading ? <Loader2 size={16} className="animate-spin" /> : t.genBtn}</button>
              </div>
              <div style={{ background: "#1e293b", color: "#e2e8f0", padding: "20px", borderRadius: "12px", minHeight: "250px", fontFamily: "monospace", fontSize: "14px", whiteSpace: "pre-wrap" }}>
                {aiResponse || <span style={{ color: "#64748b" }}>{t.wait}</span>}
              </div>
            </div>
          )}

          {selected && activeTab === "overview" && (
            <div className="dash-card" style={{ border: "2px solid #10b981", animation: "fadeIn 0.3s" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h3 style={{ margin: 0 }}>{selected.displayName || selected.name}</h3>
                <button onClick={() => setSelected(null)} className="btn-main" style={{ padding: "5px 15px", background: "#718096" }}>{t.close}</button>
              </div>
              
              <div style={{ marginTop: 18, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 12, padding: 14 }}>
                <div style={{ fontWeight: 800, marginBottom: 10 }}>{t.iinBlockTitle}</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10, alignItems: "center" }}>
                  <div style={{ fontSize: 12, fontWeight: 700 }}>{t.leaderIIN}</div>
                  <div>
                    {selected.leaderIIN ? <span style={{ fontFamily: "monospace", background: "#fff", padding: "4px 10px", borderRadius: 8 }}>{selected.leaderIIN}</span> : "—"}
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 700 }}>{t.foundersIINs}</div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {selected.foundersIINs?.length > 0 ? selected.foundersIINs.map((x, i) => (
                      <span key={i} style={{ fontFamily: "monospace", background: "#fff", padding: "4px 10px", borderRadius: 8 }}>{x}</span>
                    )) : "—"}
                  </div>
                </div>
              </div>

              {selected.rowData && Object.keys(selected.rowData).length > 0 && (
                <div style={{ marginTop: 18, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 12, padding: 14 }}>
                  <div style={{ fontWeight: 800, marginBottom: 10, color: "#0f172a" }}>{t.extraData}</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", fontSize: "12px" }}>
                    {Object.entries(selected.rowData).map(([key, value]) => (
                      <div key={key} style={{ display: "flex", flexDirection: "column", background: "#fff", padding: "10px", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
                        <span style={{ color: "#64748b", fontSize: "10px", textTransform: "uppercase", marginBottom: "4px", fontWeight: "600" }}>{key}</span>
                        <span style={{ fontWeight: 600, color: "#0f172a", wordBreak: "break-word" }}>
                          {value === "" || value === null || value === undefined ? "—" : String(value)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AnalyticsDashboard;