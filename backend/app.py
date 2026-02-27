from __future__ import annotations

import io
import os
import re
from typing import Any, Dict, List, Optional, Tuple
from collections import Counter

import pandas as pd
import httpx
from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware


# -----------------------------
# Helpers: BIN parsing & scoring
# -----------------------------

BIN_WORD_RE = re.compile(r"\b(бин|bin)\b", re.IGNORECASE)
NAME_WORD_RE = re.compile(r"\b(наименование|name|company|организац)\b", re.IGNORECASE)


def _norm_cell(x: Any) -> str:
    return re.sub(r"\s+", " ", str(x or "")).strip().lower()


def to12(v: Any) -> Optional[str]:
    """Convert value to 12-digit BIN-like string."""
    if v is None:
        return None
    s = str(v).strip()
    digits = re.sub(r"\D", "", s)
    if not digits:
        return None
    return digits[-12:].rjust(12, "0")


def level_from_score(score: int) -> str:
    if score >= 70:
        return "HIGH"
    if score >= 40:
        return "MEDIUM"
    return "LOW"


def bucket_score(score: int, step: int = 10) -> str:
    score = max(0, min(100, int(score)))
    lo = (score // step) * step
    hi = min(100, lo + step)
    if lo == 100:
        return "100"
    return f"{lo}-{hi}"


def heuristic_score(bin12: str) -> Tuple[int, List[str]]:
    """
    Базовая эвристика (чтобы всегда был результат).
    Потом замените на вашу формулу/модель/правила.
    """
    reasons: List[str] = []
    tail = int(bin12[-2:])
    score = 25

    if tail in {0, 1, 2, 3, 4}:
        score += 25
        reasons.append("Условный признак: аномальная структура идентификатора (окончание 00–04).")

    if bin12.startswith("0"):
        score += 15
        reasons.append("BIN начинается с 0 (возможная некорректная запись/формат).")

    # небольшой детерминированный “шум”
    score += (int(bin12[-1]) * 3) % 20

    score = max(0, min(100, score))
    if not reasons:
        reasons.append("Явных риск-факторов по базовой эвристике не выявлено.")
    return score, reasons


async def ollama_score(bin12: str) -> Optional[Tuple[int, str, str, int]]:
    """
    Опционально: Ollama JSON score.
    Возвращает (score, risk_level, reason, big_biz_chance) либо None.
    """
    ollama_url = os.getenv("OLLAMA_URL", "http://localhost:11434/api/generate")
    model = os.getenv("OLLAMA_MODEL", "deepseek-r1:8b")

    prompt = (
        f"Проанализируй БИН {bin12}. "
        "Верни строго JSON без пояснений: "
        '{"score": 0-100, "risk_level":"LOW|MEDIUM|HIGH", '
        '"reason":"кратко", "big_biz_chance":0-100}'
    )

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.post(
                ollama_url,
                json={"model": model, "prompt": prompt, "stream": False, "format": "json"},
            )
            resp.raise_for_status()
            data = resp.json()

        raw = (data.get("response") or "").strip()

        # убрать возможный <think>...</think>
        raw = re.sub(r"<think>[\s\S]*?</think>", "", raw).strip()

        # вытащить первый JSON-объект
        m = re.search(r"\{[\s\S]*\}", raw)
        if not m:
            return None

        j = httpx.Response(200, content=m.group(0)).json()

        score = int(j.get("score", 0))
        risk_level = str(j.get("risk_level", "")).upper() or level_from_score(score)
        reason = str(j.get("reason", "")).strip() or "Причина не указана."
        big_biz = int(j.get("big_biz_chance", 0))

        score = max(0, min(100, score))
        if risk_level not in {"LOW", "MEDIUM", "HIGH"}:
            risk_level = level_from_score(score)
        big_biz = max(0, min(100, big_biz))

        return score, risk_level, reason, big_biz
    except Exception:
        return None


# -----------------------------
# Excel parsing: robust header detection
# -----------------------------

def parse_excel_find_bin_and_name(bytes_content: bytes, scan_rows: int = 30) -> Tuple[pd.DataFrame, str, Optional[str]]:
    """
    1) Читаем лист с header=None
    2) Ищем строку заголовков, где встречается слово БИН/BIN (ваш кейс)
    3) Ставим эту строку как header
    4) Находим колонку BIN по вхождению "бин"/"bin"
    5) Находим колонку name по вхождению "наименование"/"name"/...
    """
    raw = pd.read_excel(io.BytesIO(bytes_content), header=None)

    # попытка найти строку заголовков
    header_row_idx: Optional[int] = None
    for r in range(min(scan_rows, len(raw))):
        row_vals = [_norm_cell(v) for v in raw.iloc[r].tolist()]
        if any(BIN_WORD_RE.search(v) for v in row_vals):
            header_row_idx = r
            break

    if header_row_idx is None:
        # fallback: считаем, что заголовок в первой строке
        df = pd.read_excel(io.BytesIO(bytes_content))
        df.columns = [_norm_cell(c) for c in df.columns]
        bin_col = None
        for c in df.columns:
            if "бин" in c or "bin" in c:
                bin_col = c
                break
        if not bin_col:
            raise ValueError("BIN column not found")
        name_col = None
        for c in df.columns:
            if NAME_WORD_RE.search(c):
                name_col = c
                break
        return df, bin_col, name_col

    # ставим header из найденной строки
    header_vals = [_norm_cell(v) for v in raw.iloc[header_row_idx].tolist()]
    cols = [v if v else f"col_{i}" for i, v in enumerate(header_vals)]

    df = raw.iloc[header_row_idx + 1 :].copy()
    df.columns = cols

    # убрать полностью пустые строки
    df = df.dropna(how="all")

    # найти BIN колонку
    bin_col = None
    for c in df.columns:
        cc = _norm_cell(c)
        if "бин" in cc or "bin" in cc:
            bin_col = c
            break
    if not bin_col:
        raise ValueError("BIN column not found")

    # найти name колонку
    name_col = None
    for c in df.columns:
        cc = _norm_cell(c)
        if NAME_WORD_RE.search(cc):
            name_col = c
            break

    return df, bin_col, name_col


# -----------------------------
# Charts builder
# -----------------------------

def build_charts(results: List[Dict[str, Any]]) -> Dict[str, Any]:
    level_counts = Counter([r.get("riskLevel") for r in results])
    risk_level_counts = [
        {"name": "LOW", "value": int(level_counts.get("LOW", 0))},
        {"name": "MEDIUM", "value": int(level_counts.get("MEDIUM", 0))},
        {"name": "HIGH", "value": int(level_counts.get("HIGH", 0))},
    ]

    hist = Counter([bucket_score(int(r.get("riskScore", 0))) for r in results])
    order = [f"{i}-{i+10}" for i in range(0, 100, 10)] + ["100"]
    score_histogram = [{"bucket": k, "count": int(hist.get(k, 0))} for k in order]

    top_risk = sorted(results, key=lambda x: int(x.get("riskScore", 0)), reverse=True)[:10]

    return {
        "riskLevelCounts": risk_level_counts,
        "scoreHistogram": score_histogram,
        "topRisk": top_risk,
    }


# -----------------------------
# FastAPI app
# -----------------------------

app = FastAPI(title="NX-BOSS Python Backend", version="1.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health():
    return {"ok": True}


@app.post("/api/analyze")
async def analyze(file: UploadFile = File(...)):
    content = await file.read()

    try:
        df, bin_col, name_col = parse_excel_find_bin_and_name(content, scan_rows=30)
    except Exception:
        return {"rowsAnalyzed": 0, "results": [], "sharedIINCount": 0, "charts": {}}

    results: List[Dict[str, Any]] = []

    for _, row in df.iterrows():
        bin12 = to12(row.get(bin_col))
        if not bin12:
            continue

        name = None
        if name_col:
            v = row.get(name_col)
            if v is not None and str(v).strip():
                name = str(v).strip()

        # 1) пробуем Ollama (если доступен), 2) иначе эвристика
        llm = await ollama_score(bin12)
        if llm:
            score, risk_level, reason, big_biz = llm
            reasons = [reason]
        else:
            score, reasons = heuristic_score(bin12)
            risk_level = level_from_score(score)
            big_biz = int(min(100, max(0, score + 10)))

        results.append(
            {
                "bin": bin12,
                "name": name or f"BIN {bin12}",
                "riskScore": int(score),
                "riskLevel": risk_level,
                "bigBizChance": int(big_biz),
                "reasons": reasons,
            }
        )

    charts = build_charts(results)

    return {
        "rowsAnalyzed": len(results),
        "results": results,
        "sharedIINCount": 0,
        "charts": charts,
    }