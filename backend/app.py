from __future__ import annotations

import io
import os
import re
import json
import asyncio
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from collections import Counter

import pandas as pd
import httpx
from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware

# =========================
# Settings
# =========================
USE_LLM = False  # для скорости выключено (и не нужно для задачи "имена")

GBDUL_URL = os.getenv("GBDUL_URL", "").strip()           # ваш API lookup
GBDUL_TOKEN = os.getenv("GBDUL_TOKEN", "").strip()       # опционально
GBDUL_CONCURRENCY = int(os.getenv("GBDUL_CONCURRENCY", "25"))

CACHE_PATH = Path("cache_names.json")  # id -> name


# =========================
# Utils
# =========================
BIN_WORD_RE = re.compile(r"(?:^|\b)(бин|bin|иин|iin)(?:\b|$)", re.IGNORECASE)

def _norm(x: Any) -> str:
    return re.sub(r"\s+", " ", str(x or "")).strip()

def _norm_low(x: Any) -> str:
    return _norm(x).lower()

def _is_nan(x: Any) -> bool:
    try:
        return pd.isna(x)
    except Exception:
        return False

def to12(v: Any) -> Optional[str]:
    digits = re.sub(r"\D", "", str(v or ""))
    if not digits:
        return None
    return digits[-12:].rjust(12, "0")

def infer_entity_type(id12: str) -> str:
    """
    Быстрая эвристика:
    если первые 6 цифр похожи на дату и 7-я 1..6 -> ИИН (INDIVIDUAL)
    иначе -> БИН (LEGAL)
    """
    if not id12 or len(id12) != 12:
        return "UNKNOWN"
    try:
        mm = int(id12[2:4])
        dd = int(id12[4:6])
        s = id12[6]
        if 1 <= mm <= 12 and 1 <= dd <= 31 and s in "123456":
            return "INDIVIDUAL"
        return "LEGAL"
    except Exception:
        return "UNKNOWN"


# =========================
# Excel parsing (robust header detection)
# =========================
def parse_excel_auto_header(content: bytes, scan_rows: int = 30) -> pd.DataFrame:
    """
    Реестр может иметь заголовок не в 1-й строке.
    Ищем строку где встречается БИН/ИИН/BIN/IIN и ставим её как header.
    """
    raw = pd.read_excel(io.BytesIO(content), header=None)

    header_row = None
    for r in range(min(scan_rows, len(raw))):
        row_vals = [_norm_low(v) for v in raw.iloc[r].tolist()]
        if any(BIN_WORD_RE.search(v) for v in row_vals):
            header_row = r
            break

    if header_row is None:
        df = pd.read_excel(io.BytesIO(content))
        df.columns = [_norm_low(c) for c in df.columns]
        return df

    headers = [_norm_low(v) for v in raw.iloc[header_row].tolist()]
    headers = [h if h else f"col_{i}" for i, h in enumerate(headers)]

    df = raw.iloc[header_row + 1:].copy()
    df.columns = headers
    df = df.dropna(how="all")
    return df

def find_id_col(df: pd.DataFrame) -> Optional[str]:
    # 1) по заголовку
    for c in df.columns:
        cc = _norm_low(c)
        if "бин" in cc or "bin" in cc or "иин" in cc or "iin" in cc:
            return c

    # 2) fallback по содержимому (много 12-значных)
    best_col, best_ratio = None, 0.0
    for c in df.columns:
        ser = df[c].dropna()
        if len(ser) < 5:
            continue
        sample = ser.head(500)
        ok = 0
        for v in sample:
            d = re.sub(r"\D", "", str(v or ""))
            if len(d) == 12:
                ok += 1
        ratio = ok / max(1, len(sample))
        if ratio > best_ratio:
            best_ratio, best_col = ratio, c

    return best_col if best_ratio >= 0.5 else None


# =========================
# Cache
# =========================
def load_cache() -> Dict[str, str]:
    if CACHE_PATH.exists():
        try:
            return json.loads(CACHE_PATH.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}

def save_cache(cache: Dict[str, str]) -> None:
    try:
        CACHE_PATH.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")
    except Exception:
        pass


# =========================
# GBDUL lookup (name by BIN/IIN)
# =========================
async def gbdul_lookup_name(id12: str) -> Optional[str]:
    """
    Ожидаем ваш API:
      POST GBDUL_URL
      body: {"id": "12digits"}  (если у вас другой ключ — поменяйте здесь)
      response: JSON с одним из ключей:
        name/fullName/full_name/fio/companyName/title/naimenovanie
      или внутри data/result/payload.
    """
    if not GBDUL_URL:
        return None

    headers = {}
    if GBDUL_TOKEN:
        headers["Authorization"] = f"Bearer {GBDUL_TOKEN}"

    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            r = await client.post(GBDUL_URL, json={"id": id12}, headers=headers)
            r.raise_for_status()
            j = r.json()

        def pick(d: dict) -> Optional[str]:
            for k in ["name", "fullName", "full_name", "fio", "companyName", "company_name", "title", "naimenovanie"]:
                if k in d and d[k]:
                    return str(d[k]).strip()
            return None

        name = pick(j)
        if name:
            return name

        for box in ["data", "result", "payload"]:
            if box in j and isinstance(j[box], dict):
                name2 = pick(j[box])
                if name2:
                    return name2

        return None
    except Exception:
        return None


async def batch_lookup(ids: List[str], concurrency: int) -> Dict[str, str]:
    sem = asyncio.Semaphore(max(1, concurrency))
    out: Dict[str, str] = {}

    async def one(x: str):
        async with sem:
            nm = await gbdul_lookup_name(x)
            if nm:
                out[x] = nm

    await asyncio.gather(*(one(i) for i in ids))
    return out


# =========================
# Charts
# =========================
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

def heuristic_score(id12: str) -> Tuple[int, List[str]]:
    # быстрый скоринг-заглушка (можно убрать/заменить)
    reasons: List[str] = []
    score = 50 + (int(id12[-1]) * 3) % 30
    score = max(0, min(100, score))
    reasons.append("Скоринг демо-режим (для хакатона).")
    return score, reasons

def build_charts(results: List[Dict[str, Any]]) -> Dict[str, Any]:
    level_counts = Counter([r.get("riskLevel") for r in results])
    riskLevelCounts = [
        {"name": "LOW", "value": int(level_counts.get("LOW", 0))},
        {"name": "MEDIUM", "value": int(level_counts.get("MEDIUM", 0))},
        {"name": "HIGH", "value": int(level_counts.get("HIGH", 0))},
    ]

    hist = Counter([bucket_score(int(r.get("riskScore", 0))) for r in results])
    order = [f"{i}-{i+10}" for i in range(0, 100, 10)] + ["100"]
    scoreHistogram = [{"bucket": k, "count": int(hist.get(k, 0))} for k in order]

    topRisk = sorted(results, key=lambda x: int(x.get("riskScore", 0)), reverse=True)[:10]
    return {"riskLevelCounts": riskLevelCounts, "scoreHistogram": scoreHistogram, "topRisk": topRisk}


# =========================
# FastAPI
# =========================
app = FastAPI(title="NX-BOSS Backend", version="3.0.0")
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

    df = parse_excel_auto_header(content, scan_rows=30)
    df.columns = [_norm_low(c) for c in df.columns]

    id_col = find_id_col(df)
    if not id_col:
        return {
            "rowsAnalyzed": 0,
            "results": [],
            "sharedIINCount": 0,
            "charts": {},
            "individuals": [],
            "legalEntities": [],
        }

    # 1) собрать уникальные ID (чтобы не дергать API по 100 раз одинаковое)
    unique_ids = sorted({to12(v) for v in df[id_col].tolist() if to12(v)})

    # 2) кеш + догрузка missing параллельно
    cache = load_cache()
    missing = [i for i in unique_ids if i not in cache]

    if missing:
        fetched = await batch_lookup(missing, concurrency=GBDUL_CONCURRENCY)
        cache.update(fetched)
        save_cache(cache)

    names_map = cache

    # 3) собрать results
    results: List[Dict[str, Any]] = []
    individuals: Dict[str, str] = {}
    legal_entities: Dict[str, str] = {}

    for v in df[id_col].tolist():
        id12 = to12(v)
        if not id12:
            continue

        entityType = infer_entity_type(id12)
        name = names_map.get(id12)  # имя из API/кеша
        if not name:
            name = ("ФЛ " if entityType == "INDIVIDUAL" else "ЮЛ ") + id12

        score, reasons = heuristic_score(id12)
        riskLevel = level_from_score(score)

        results.append({
            "id": id12,
            "entityType": entityType,     # INDIVIDUAL | LEGAL
            "displayName": name,          # главное поле для фин.отдела
            "riskScore": int(score),
            "riskLevel": riskLevel,
            "reasons": reasons,
        })

        if entityType == "INDIVIDUAL":
            individuals[id12] = name
        elif entityType == "LEGAL":
            legal_entities[id12] = name

    charts = build_charts(results)

    return {
        "rowsAnalyzed": len(results),
        "results": results,
        "sharedIINCount": 0,
        "charts": charts,
        "individuals": [{"id": k, "name": v} for k, v in individuals.items()],
        "legalEntities": [{"id": k, "name": v} for k, v in legal_entities.items()],
    }