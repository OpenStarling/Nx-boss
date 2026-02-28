import React, { useState, useMemo, useEffect } from "react";
import {
  LayoutDashboard, ShieldAlert, Users, Download, Copy, ChevronRight,
  PieChart as PieIcon, Fingerprint, Building2, Sparkles, Loader2, Bot, Globe,
  ArrowUp, ArrowDown, ArrowUpDown
} from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import html2pdf from "html2pdf.js";
import SignalsMap from "./SignalsMap";
import "./Dashboard.css";

const API_BASE = "http://localhost:3001";

const dict = {
  ru: {
    dash: "Дашборд", db: "База субъектов", ai: "AI Анализ",
    export: "Экспорт PDF", riskStruct: "Структура рисков",
    high: "Высокий", med: "Средний", low: "Низкий",
    total: "ВСЕГО ОБЪЕКТОВ", critRisk: "КРИТИЧЕСКИЙ РИСК", medRisk: "СРЕДНИЙ РИСК", links: "СВЯЗИ ИИН",
    registry: "Реестр высокого риска", name: "Наименование", status: "Статус", region: "Регион", oked: "ОКЭД / Отрасль", action: "Действие",
    indiv: "Физ. лица (ИИН)", entities: "Юр. лица (БИН)",
    aiTitle: "Локальный AI Анализ (DeepSeek)", genBtn: "Сгенерировать анализ",
    close: "Закрыть", score: "ОЦЕНКА РИСКА", factors: "Выявленные факторы риска:",
    wait: "Ожидание системы... Убедитесь, что Ollama запущена.",
    promptLang: "Отвечай строго на русском языке.",
    iinBlockTitle: "ИИН (по БИН из ГБД ЮЛ)",
    leaderIIN: "Руководитель (ИИН)",
    foundersIINs: "Учредители (ИИН)",
    iinLoading: "Загружаем ИИН...",
    iinEmpty: "ИИН не найден (или это ФЛ).",
    iinError: "Ошибка получения ИИН",
    openApiHint: "Проверь, что бэкенд запущен и роут /api/get-iin-by-bin доступен."
  },
  kz: {
    dash: "Басқару тақтасы", db: "Субъектілер базасы", ai: "AI Талдау",
    export: "PDF жүктеу", riskStruct: "Тәуекелдер құрылымы",
    high: "Жоғары", med: "Орташа", low: "Төмен",
    total: "БАРЛЫҚ НЫСАНДАР", critRisk: "КРИТИКАЛЫҚ ТӘУЕКЕЛ", medRisk: "ОРТАША ТӘУЕКЕЛ", links: "ЖСН БАЙЛАНЫСТАРЫ",
    registry: "Жоғары тәуекел тізілімі", name: "Атауы", status: "Мәртебесі", region: "Аймақ", oked: "ЭҚЖЖ / Сала", action: "Әрекет",
    indiv: "Жеке тұлғалар (ЖСН)", entities: "Заңды тұлғалар (БСН)",
    aiTitle: "Жергілікті AI Талдау (DeepSeek)", genBtn: "Талдау жасау",
    close: "Жабу", score: "ТӘУЕКЕЛДІ БАҒАЛАУ", factors: "Анықталған тәуекел факторлары:",
    wait: "Жүйені күту... Ollama қосылғанына көз жеткізіңіз.",
    promptLang: "Отвечай строго на казахском языке (Қазақ тілінде жауап бер).",
    iinBlockTitle: "ЖСН (БСН арқылы ГБД ЮЛ-дан)",
    leaderIIN: "Басшы (ЖСН)",
    foundersIINs: "Құрылтайшылар (ЖСН)",
    iinLoading: "ЖСН жүктелуде...",
    iinEmpty: "ЖСН табылмады (немесе бұл ЖТ).",
    iinError: "ЖСН алу қатесі",
    openApiHint: "Бэкенд қосулы ма және /api/get-iin-by-bin қолжетімді ме — тексер."
  }
};

const extractId = (obj) => {
  if (!obj) return "—";
  const directId =
    obj.id || obj.iin || obj.bin || obj.IIN || obj.BIN ||
    obj.foundersFL?.[0]?.IIN || obj.foundersUL?.[0]?.BIN;
  if (directId) return String(directId).trim();

  let found = null;
  const search = (item) => {
    if (found || !item) return;
    if (typeof item === "object") {
      for (let key in item) {
        const lowerKey = key.toLowerCase();
        const val = item[key];
        if (lowerKey.includes("иин") || lowerKey.includes("бин") || lowerKey.includes("iin") || lowerKey.includes("bin")) {
          const strVal = String(val).replace(/\D/g, "");
          if (strVal.length >= 9 && strVal.length <= 12) {
            found = strVal.padStart(12, "0");
            return;
          }
        }
        if (typeof val === "string" || typeof val === "number") {
          const strVal = String(val).replace(/\D/g, "");
          if (strVal.length === 12) found = strVal;
        }
        if (typeof val === "object") search(val);
      }
    }
  };
  search(obj);
  return found || "—";
};

const extractOked = (obj) => {
  if (!obj) return "—";
  const directOked = obj.oked || obj.industry || obj.OKED || obj.Oked || obj.okedName || obj.okedNameRu;
  if (directOked) return String(directOked).trim();

  for (let key in obj) {
    const lKey = key.toLowerCase();
    if (lKey.includes("окэд") || lKey.includes("отрасль")) return String(obj[key]).trim();
  }
  return "—";
};

const AnalyticsDashboard = ({ data }) => {
  const [activeTab, setActiveTab] = useState("overview");
  const [selected, setSelected] = useState(null);
  const [lang, setLang] = useState("ru");
  const [aiResponse, setAiResponse] = useState("");
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [sortConfig, setSortConfig] = useState({ key: null, direction: "asc" });

  // ✅ NEW: IIN drill-down state
  const [iinInfo, setIinInfo] = useState(null); // { leaderIIN, foundersIINs }
  const [iinLoading, setIinLoading] = useState(false);
  const [iinErr, setIinErr] = useState("");

  const t = dict[lang];

  const stats = useMemo(() => {
    const counts = { HIGH: 0, MEDIUM: 0, LOW: 0 };
    data?.results?.forEach((item) => {
      counts[item.riskLevel] = (counts[item.riskLevel] || 0) + 1;
    });
    return [
      { name: t.high, value: counts.HIGH, color: "#ef4444" },
      { name: t.med, value: counts.MEDIUM, color: "#d4af37" },
      { name: t.low, value: counts.LOW, color: "#10b981" }
    ];
  }, [data, t]);

  const sortedResults = useMemo(() => {
    let sortableItems = [...(data?.results || [])];
    if (sortConfig.key) {
      sortableItems.sort((a, b) => {
        let aVal = "";
        let bVal = "";

        if (sortConfig.key === "id") {
          aVal = extractId(a);
          bVal = extractId(b);
        } else if (sortConfig.key === "name") {
          aVal = a.displayName || a.name || "";
          bVal = b.displayName || b.name || "";
        } else if (sortConfig.key === "oked") {
          aVal = extractOked(a);
          bVal = extractOked(b);
        } else {
          aVal = a[sortConfig.key] || "";
          bVal = b[sortConfig.key] || "";
        }

        if (aVal < bVal) return sortConfig.direction === "asc" ? -1 : 1;
        if (aVal > bVal) return sortConfig.direction === "asc" ? 1 : -1;
        return 0;
      });
    }
    return sortableItems;
  }, [data, sortConfig]);

  const requestSort = (key) => {
    let direction = "asc";
    if (sortConfig.key === key && sortConfig.direction === "asc") direction = "desc";
    setSortConfig({ key, direction });
  };

  const SortIcon = ({ columnKey }) => {
    if (sortConfig.key !== columnKey) return <ArrowUpDown size={12} style={{ marginLeft: 4, opacity: 0.3 }} />;
    return sortConfig.direction === "asc"
      ? <ArrowUp size={12} style={{ marginLeft: 4, color: "#10b981" }} />
      : <ArrowDown size={12} style={{ marginLeft: 4, color: "#10b981" }} />;
  };

  const copyToClipboard = (text) => navigator.clipboard.writeText(text);

  const exportPDF = () => {
    const element = document.getElementById("pdf-area");
    html2pdf()
      .from(element)
      .set({
        margin: 10,
        filename: "GreenGuard_Report.pdf",
        html2canvas: { scale: 2 },
        jsPDF: { orientation: "landscape", format: "a3" }
      })
      .save();
  };

  const generateAISummary = async () => {
    setIsAiLoading(true);
    setAiResponse("");
    const highCount = stats.find((s) => s.name === t.high)?.value || 0;
    const prompt = `Act as an AML/KYC officer. Analyze: ${data?.rowsAnalyzed || 0} objects, ${highCount} high risk. Provide executive summary and 3 action steps. ${t.promptLang}`;

    try {
      const res = await fetch("http://localhost:11434/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "deepseek-r1:8b", prompt, stream: true })
      });

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const lines = decoder.decode(value).split("\n").filter(Boolean);
        for (let line of lines) setAiResponse((prev) => prev + JSON.parse(line).response);
      }
    } catch {
      setAiResponse("Connection to Ollama failed. Check port 11434.");
    } finally {
      setIsAiLoading(false);
    }
  };

  // ✅ NEW: when selected changes, fetch IIN by BIN via backend which uses iin_service.py
  useEffect(() => {
    let cancelled = false;

    const loadIIN = async () => {
      setIinErr("");
      setIinInfo(null);

      if (!selected) return;

      // Берем бин из selected (у вас в results сейчас часто bin/id)
      const bin12 = (selected.bin || selected.id || "").toString();
      const entityType = (selected.entityType || "").toString().toUpperCase();

      // Запрашиваем только для ЮЛ (BIN). Если у вас entityType не приходит — всё равно попробуем, но только если это не выглядит как ИИН-физлица.
      const shouldTry =
        (entityType === "LEGAL") ||
        (entityType === "" && /^\d{12}$/.test(bin12));

      if (!shouldTry) return;

      setIinLoading(true);
      try {
        const url = `${API_BASE}/api/get-iin-by-bin?bin=${encodeURIComponent(bin12)}`;
        const r = await fetch(url);
        if (!r.ok) {
          throw new Error(`HTTP ${r.status}`);
        }
        const j = await r.json(); // { leaderIIN, foundersIINs }
        if (cancelled) return;

        setIinInfo({
          leaderIIN: j?.leaderIIN || null,
          foundersIINs: Array.isArray(j?.foundersIINs) ? j.foundersIINs : []
        });
      } catch (e) {
        if (cancelled) return;
        setIinErr(`${t.iinError}. ${t.openApiHint}`);
      } finally {
        if (!cancelled) setIinLoading(false);
      }
    };

    loadIIN();
    return () => { cancelled = true; };
  }, [selected, t.iinError, t.openApiHint]);

  return (
    <div className="dashboard-wrapper">
      <header
        className="main-header"
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", padding: "0 40px" }}
      >
        <div className="logo-container">
          <div className="logo-box">G</div>
          <div className="logo-text">
            GreenGuard <span style={{ color: "#d4af37" }}>Intelligence</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <Globe size={18} color="#718096" />
          <button
            onClick={() => setLang("ru")}
            style={{
              background: lang === "ru" ? "#10b981" : "transparent",
              color: lang === "ru" ? "#fff" : "#718096",
              border: "none",
              padding: "4px 8px",
              borderRadius: "6px",
              cursor: "pointer",
              fontWeight: "bold"
            }}
          >
            RU
          </button>
          <button
            onClick={() => setLang("kz")}
            style={{
              background: lang === "kz" ? "#10b981" : "transparent",
              color: lang === "kz" ? "#fff" : "#718096",
              border: "none",
              padding: "4px 8px",
              borderRadius: "6px",
              cursor: "pointer",
              fontWeight: "bold"
            }}
          >
            KZ
          </button>
        </div>
      </header>

      <div className="content-container">
        <nav className="tabs-nav">
          <button className={`tab-link ${activeTab === "overview" ? "active" : ""}`} onClick={() => setActiveTab("overview")}>
            <LayoutDashboard size={18} /> {t.dash}
          </button>
          <button className={`tab-link ${activeTab === "database" ? "active" : ""}`} onClick={() => setActiveTab("database")}>
            <Users size={18} /> {t.db}
          </button>
          <button className={`tab-link ${activeTab === "aisum" ? "active" : ""}`} onClick={() => setActiveTab("aisum")}>
            <Sparkles size={18} color="#d4af37" /> {t.ai}
          </button>
        </nav>

        {activeTab === "overview" && (
          <div style={{ display: "flex", justifyContent: "center", marginBottom: "10px" }}>
            <button className="btn-main" onClick={exportPDF}>
              <Download size={18} style={{ marginRight: 8 }} /> {t.export}
            </button>
          </div>
        )}

        <div id="pdf-area" style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
          {activeTab === "overview" && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "20px" }}>
                <div className="dash-card" style={{ padding: 0, overflow: "hidden" }}>
                  <SignalsMap pollMs={5000} selectedItem={selected} lang={lang} />
                </div>

                <div className="dash-card">
                  <h4 style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <PieIcon size={18} color="#10b981" /> {t.riskStruct}
                  </h4>
                  <div style={{ height: "250px", width: "100%" }}>
                    <ResponsiveContainer>
                      <PieChart>
                        <Pie data={stats} innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value">
                          {stats.map((e, i) => <Cell key={i} fill={e.color} />)}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div style={{ fontSize: "12px", marginTop: "10px" }}>
                    {stats.map((s) => (
                      <div key={s.name} style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                        <span>{s.name}</span>
                        <span style={{ fontWeight: 700, color: s.color }}>{s.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "20px" }}>
                <div className="dash-card">
                  <div style={{ color: "#718096", fontSize: "12px", fontWeight: 600 }}>{t.total}</div>
                  <div style={{ fontSize: "28px", fontWeight: 800, color: "#2d3748" }}>{data?.rowsAnalyzed || 0}</div>
                </div>
                <div className="dash-card" style={{ borderBottom: "4px solid #ef4444" }}>
                  <div style={{ color: "#ef4444", fontSize: "12px", fontWeight: 600 }}>{t.critRisk}</div>
                  <div style={{ fontSize: "28px", fontWeight: 800 }}>{data?.results?.filter((r) => r.riskLevel === "HIGH").length || 0}</div>
                </div>
                <div className="dash-card" style={{ borderBottom: "4px solid #d4af37" }}>
                  <div style={{ color: "#d4af37", fontSize: "12px", fontWeight: 600 }}>{t.medRisk}</div>
                  <div style={{ fontSize: "28px", fontWeight: 800 }}>{data?.results?.filter((r) => r.riskLevel === "MEDIUM").length || 0}</div>
                </div>
                <div className="dash-card">
                  <div style={{ color: "#10b981", fontSize: "12px", fontWeight: 600 }}>{t.links}</div>
                  <div style={{ fontSize: "28px", fontWeight: 800 }}>{data?.sharedIINCount || 0}</div>
                </div>
              </div>

              <div className="dash-card">
                <h4 style={{ marginBottom: 20, display: "flex", alignItems: "center", gap: 10 }}>
                  <ShieldAlert color="#10b981" /> {t.registry}
                </h4>
                <div style={{ overflowX: "auto" }}>
                  <table className="clean-table" style={{ minWidth: "900px" }}>
                    <thead>
                      <tr>
                        <th onClick={() => requestSort("id")} style={{ cursor: "pointer", whiteSpace: "nowrap", userSelect: "none" }}>
                          БИН / ЖСН <SortIcon columnKey="id" />
                        </th>
                        <th onClick={() => requestSort("name")} style={{ cursor: "pointer", whiteSpace: "nowrap", userSelect: "none" }}>
                          {t.name} <SortIcon columnKey="name" />
                        </th>
                        <th onClick={() => requestSort("riskLevel")} style={{ cursor: "pointer", whiteSpace: "nowrap", userSelect: "none" }}>
                          {t.status} <SortIcon columnKey="riskLevel" />
                        </th>
                        <th onClick={() => requestSort("cityRu")} style={{ cursor: "pointer", whiteSpace: "nowrap", userSelect: "none" }}>
                          {t.region} <SortIcon columnKey="cityRu" />
                        </th>
                        <th onClick={() => requestSort("oked")} style={{ cursor: "pointer", whiteSpace: "nowrap", userSelect: "none" }}>
                          {t.oked} <SortIcon columnKey="oked" />
                        </th>
                        <th>{t.action}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedResults.map((item, idx) => (
                        <tr key={idx} style={{ background: selected?.id === item.id ? "#f0fdf4" : "transparent" }}>
                          <td style={{ fontWeight: 700, fontFamily: "monospace" }}>{extractId(item)}</td>
                          <td>{item.displayName || item.name || "—"}</td>
                          <td><span className={`risk-badge ${item.riskLevel}`}>{item.riskLevel}</span></td>
                          <td>{item.cityRu || "—"}</td>
                          <td
                            style={{ fontSize: "11px", maxWidth: "200px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                            title={extractOked(item)}
                          >
                            {extractOked(item)}
                          </td>
                          <td>
                            <button className="tab-link" onClick={() => setSelected(item)}>
                              <ChevronRight size={16} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {activeTab === "database" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
              <div className="dash-card">
                <h4 style={{ display: "flex", alignItems: "center", gap: 10, color: "#10b981" }}>
                  <Fingerprint size={20} /> {t.indiv}
                </h4>
                <div style={{ maxHeight: "500px", overflowY: "auto" }}>
                  <table className="clean-table">
                    <thead>
                      <tr><th>ИИН / ЖСН</th><th>{t.name}</th><th></th></tr>
                    </thead>
                    <tbody>
                      {data?.individuals?.map((x, i) => (
                        <tr key={i}>
                          <td style={{ fontSize: "12px", fontFamily: "monospace" }}>{extractId(x)}</td>
                          <td style={{ fontSize: "12px" }}>{x.name}</td>
                          <td>
                            <button className="icon-btn" onClick={() => copyToClipboard(extractId(x))}>
                              <Copy size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="dash-card">
                <h4 style={{ display: "flex", alignItems: "center", gap: 10, color: "#d4af37" }}>
                  <Building2 size={20} /> {t.entities}
                </h4>
                <div style={{ maxHeight: "500px", overflowY: "auto" }}>
                  <table className="clean-table">
                    <thead>
                      <tr><th>БИН / БСН</th><th>{t.name}</th><th></th></tr>
                    </thead>
                    <tbody>
                      {data?.legalEntities?.map((x, i) => (
                        <tr key={i}>
                          <td style={{ fontSize: "12px", fontFamily: "monospace" }}>{extractId(x)}</td>
                          <td style={{ fontSize: "12px" }}>{x.name}</td>
                          <td>
                            <button className="icon-btn" onClick={() => copyToClipboard(extractId(x))}>
                              <Copy size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {activeTab === "aisum" && (
            <div className="dash-card" style={{ minHeight: "400px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                <h4 style={{ display: "flex", alignItems: "center", gap: 10, color: "#d4af37" }}>
                  <Bot size={24} /> {t.aiTitle}
                </h4>
                <button className="btn-main" onClick={generateAISummary} disabled={isAiLoading} style={{ background: "#2d3748" }}>
                  {isAiLoading ? <Loader2 size={16} className="animate-spin" /> : t.genBtn}
                </button>
              </div>
              <div
                style={{
                  background: "#1e293b",
                  color: "#e2e8f0",
                  padding: "20px",
                  borderRadius: "12px",
                  minHeight: "250px",
                  fontFamily: "monospace",
                  fontSize: "14px",
                  lineHeight: "1.6",
                  whiteSpace: "pre-wrap"
                }}
              >
                {aiResponse || <span style={{ color: "#64748b" }}>{t.wait}</span>}
                {isAiLoading && (
                  <span
                    style={{
                      display: "inline-block",
                      width: "8px",
                      height: "16px",
                      background: "#d4af37",
                      animation: "pulse 1s infinite",
                      marginLeft: "4px"
                    }}
                  />
                )}
              </div>
            </div>
          )}

          {/* ✅ Selected details + IIN block */}
          {selected && activeTab === "overview" && (
            <div className="dash-card" style={{ border: "2px solid #10b981", animation: "fadeIn 0.3s", backgroundColor: "#fff" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h3 style={{ margin: 0 }}>{selected.displayName || selected.name}</h3>
                <button onClick={() => setSelected(null)} className="btn-main" style={{ padding: "5px 15px", background: "#718096" }}>
                  {t.close}
                </button>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginTop: 20 }}>
                <div style={{ background: "#f0fdf4", padding: 15, borderRadius: 12 }}>
                  <div style={{ fontSize: 11, color: "#10b981", fontWeight: 700 }}>ID</div>
                  <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: 1 }}>{extractId(selected)}</div>
                </div>
                <div style={{ background: "#fdfbeb", padding: 15, borderRadius: 12 }}>
                  <div style={{ fontSize: 11, color: "#d4af37", fontWeight: 700 }}>{t.score}</div>
                  <div style={{ fontSize: 20, fontWeight: 800 }}>{selected.riskScore || 0}%</div>
                </div>
              </div>

              {/* ✅ NEW IIN section */}
              <div style={{ marginTop: 18, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 12, padding: 14 }}>
                <div style={{ fontWeight: 800, marginBottom: 10, color: "#0f172a" }}>{t.iinBlockTitle}</div>

                {iinLoading && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#64748b" }}>
                    <Loader2 size={16} className="animate-spin" /> {t.iinLoading}
                  </div>
                )}

                {!iinLoading && iinErr && (
                  <div style={{ color: "#ef4444", fontWeight: 700 }}>
                    {iinErr}
                  </div>
                )}

                {!iinLoading && !iinErr && (
                  <>
                    {(!iinInfo || (!iinInfo.leaderIIN && (!iinInfo.foundersIINs || iinInfo.foundersIINs.length === 0))) ? (
                      <div style={{ color: "#64748b" }}>{t.iinEmpty}</div>
                    ) : (
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10 }}>
                        <div style={{ fontSize: 12, color: "#334155", fontWeight: 700 }}>{t.leaderIIN}</div>
                        <div style={{ fontFamily: "monospace", fontSize: 13 }}>
                          {iinInfo.leaderIIN ? (
                            <span>
                              {iinInfo.leaderIIN}
                              <button
                                className="icon-btn"
                                style={{ marginLeft: 8 }}
                                onClick={() => copyToClipboard(iinInfo.leaderIIN)}
                                title="Copy"
                              >
                                <Copy size={14} />
                              </button>
                            </span>
                          ) : "—"}
                        </div>

                        <div style={{ fontSize: 12, color: "#334155", fontWeight: 700 }}>{t.foundersIINs}</div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                          {(iinInfo.foundersIINs || []).length ? (
                            iinInfo.foundersIINs.map((x, i) => (
                              <span
                                key={i}
                                style={{
                                  fontFamily: "monospace",
                                  fontSize: 12,
                                  background: "#ffffff",
                                  border: "1px solid #e2e8f0",
                                  padding: "6px 10px",
                                  borderRadius: 10
                                }}
                              >
                                {x}
                                <button
                                  className="icon-btn"
                                  style={{ marginLeft: 6 }}
                                  onClick={() => copyToClipboard(x)}
                                  title="Copy"
                                >
                                  <Copy size={14} />
                                </button>
                              </span>
                            ))
                          ) : (
                            <span style={{ color: "#64748b" }}>—</span>
                          )}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>

              <div style={{ marginTop: 20 }}>
                <div style={{ fontWeight: 700, marginBottom: 10, color: "#2d3748" }}>{t.factors}</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                  {selected.reasons?.map((r, i) => (
                    <span
                      key={i}
                      style={{
                        background: "#f8faf9",
                        border: "1px solid #e2e8f0",
                        padding: "6px 12px",
                        borderRadius: "8px",
                        fontSize: "13px"
                      }}
                    >
                      {r}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AnalyticsDashboard;