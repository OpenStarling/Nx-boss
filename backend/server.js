import express from "express";
import cors from "cors";
import Database from "better-sqlite3";
import multer from "multer";
import XLSX from "xlsx";
import fetch from "node-fetch";

const app = express();
const port = 3001;

app.use(cors());
app.use(express.json());

// База данных истории
const db = new Database("nx_boss.db");
db.exec("CREATE TABLE IF NOT EXISTS history (id INTEGER PRIMARY KEY, prompt TEXT, response TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)");

const upload = multer({ storage: multer.memoryStorage() });

// Конфиг ГБДЮЛ (твои данные)
const GBDUL_URL = "http://192.168.0.31:8830/gbdulbybin/send-request";
const REQUESTOR_BIN = "970840000277";
const OLLAMA_URL = "http://localhost:11434/api/generate";

let ORG_CACHE = {}; 
let IIN_INDEX = {};
let LAST_ANALYSIS = null;

// Хелперы
const to12 = (v) => v ? String(v).replace(/\D/g, "").padStart(12, "0").slice(-12) : null;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Интеграция с ГБДЮЛ
const callGBDUL = async (bin) => {
    try {
        const res = await fetch(GBDUL_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": "Basic as base64" },
            body: JSON.stringify({ bin, requestor_bin: REQUESTOR_BIN })
        });
        const json = await res.json();
        return { ok: true, org: json?.data?.organization };
    } catch (e) { return { ok: false }; }
};

// Анализ Excel
app.post("/api/analyze", upload.single("file"), async (req, res) => {
    const wb = XLSX.read(req.file.buffer, { type: "buffer" });
    const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
    
    const results = [];
    IIN_INDEX = {};

    for (const row of data.slice(0, 10)) { // Для теста берем первые 10
        const bin = to12(row['БИН'] || row['bin']);
        if (!bin) continue;

        const { ok, org } = await callGBDUL(bin);
        if (ok && org) {
            ORG_CACHE[bin] = org;
            const score = Math.floor(Math.random() * 100); // Здесь твоя логика baseRisk
            results.push({ bin, name: org.fullNameRu, riskScore: score, riskLevel: score > 70 ? "HIGH" : "LOW" });
        }
        await sleep(100);
    }
    res.json({ rowsAnalyzed: results.length, results, sharedIINCount: 0 });
});

// Чат с ИИ
app.post("/api/chat", async (req, res) => {
    const { message } = req.body;
    const bin = to12(message);

    const prompt = `Проанализируй БИН ${bin}. Верни JSON: {"score": 85, "risk_level": "HIGH", "reason": "Офшорные связи", "big_biz_chance": 90}`;

    try {
        const ollamaRes = await fetch(OLLAMA_URL, {
            method: "POST",
            body: JSON.stringify({ model: "deepseek-r1:8b", prompt, stream: false, format: "json" })
        });
        const data = await ollamaRes.json();
        const ai = JSON.parse(data.response.replace(/<think>[\s\S]*?<\/think>/g, ''));
        res.json(ai);
    } catch (e) { res.status(500).json({ error: "Ollama Error" }); }
});

app.listen(port, () => console.log(`🚀 Server ready at http://localhost:${port}`));