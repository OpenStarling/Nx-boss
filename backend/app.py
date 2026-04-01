from __future__ import annotations

import io
import re
import json
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from collections import Counter, defaultdict

import pandas as pd
from fastapi import FastAPI, UploadFile, File, Query
from fastapi.middleware.cors import CORSMiddleware

from iin_service import get_iins_by_bin


# ============================================================
# Cache
# ============================================================
CACHE_PROFILES_PATH = Path("cache_people.json")  # кэш ФЛ по ИИН (имена можно подгружать позже)
LAST_RESULTS: List[Dict[str, Any]] = []


# ============================================================
# Helpers
# ============================================================
BIN_WORD_RE = re.compile(r"(?:^|\b)(бин|bin|иин|iin)(?:\b|$)", re.IGNORECASE)


def _norm(x: Any) -> str:
    return re.sub(r"\s+", " ", str(x or "")).strip()


def _norm_low(x: Any) -> str:
    return _norm(x).lower()


def to12(v: Any) -> Optional[str]:
    digits = re.sub(r"\D", "", str(v or ""))
    if not digits:
        return None
    return digits[-12:].rjust(12, "0")


def infer_entity_type(id12: str) -> str:
    """
    Эвристика: ИИН похож на дату рождения (yy mm dd) и 7й символ 1..6
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


def safe_int(x: Any, default: int = 999999) -> int:
    try:
        s = re.sub(r"\D", "", str(x or ""))
        return int(s) if s else default
    except Exception:
        return default


def load_people_cache() -> Dict[str, Dict[str, Any]]:
    if CACHE_PROFILES_PATH.exists():
        try:
            return json.loads(CACHE_PROFILES_PATH.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}


def save_people_cache(cache: Dict[str, Dict[str, Any]]) -> None:
    try:
        CACHE_PROFILES_PATH.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")
    except Exception:
        pass


# ============================================================
# Excel parsing
# ============================================================
def parse_excel_auto_header(content: bytes, scan_rows: int = 30) -> pd.DataFrame:
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
    for c in df.columns:
        cc = _norm_low(c)
        if "бин" in cc or "bin" in cc or "иин" in cc or "iin" in cc:
            return c

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


# ============================================================
# Scoring + charts
# ============================================================
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
    # демо скоринг
    score = 50 + (int(id12[-1]) * 3) % 30
    score = max(0, min(100, score))
    return score, ["Скоринг демо-режим (для хакатона)."]


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


# ============================================================
# FastAPI
# ============================================================
app = FastAPI(title="NX-BOSS Backend", version="9.0.0")
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


@app.get("/api/get-iin-by-bin")
async def api_get_iin_by_bin(bin: str = Query(..., description="12-digit BIN")):
    """
    Проверочный эндпоинт: вернёт leaderIIN + foundersIINs по БИН
    """
    b = to12(bin)
    if not b:
        return {"error": "Invalid BIN"}
    return await get_iins_by_bin(b)


@app.post("/api/analyze")
async def analyze(file: UploadFile = File(...)):
    """
    Универсальный эндпоинт: читает Excel с БИН или ИИН.
    Возвращает данные с сохранением исходных колонок (rowData) и найденных связей.
    """
    global LAST_RESULTS

    content = await file.read()
    df = parse_excel_auto_header(content, scan_rows=30)
    df.columns = [_norm_low(c) for c in df.columns]
    
    # Заменяем NaN на пустые строки, чтобы FastAPI (JSON) не выдавал ошибку
    df = df.fillna("")

    id_col = find_id_col(df)
    if not id_col:
        LAST_RESULTS = []
        return {
            "rowsAnalyzed": 0,
            "results": [],
            "sharedIINCount": 0,
            "charts": {},
            "individuals": [],
            "legalEntities": [],
        }

    # Сохраняем строки в виде словарей, чтобы прокинуть "другие данные" на фронт
    records = df.to_dict("records")
    
    unique_ids = set()
    for row in records:
        val = to12(row.get(id_col))
        if val:
            unique_ids.add(val)
            
    unique_ids = sorted(unique_ids)

    individuals: Dict[str, str] = {}
    legal_entities: Dict[str, str] = {}
    bin_meta: Dict[str, Dict[str, Any]] = {}
    extra_iins: set[str] = set()

    # ---------
    # 1) Обрабатываем ЮЛ (BIN)
    # ---------
    for id12 in unique_ids:
        if infer_entity_type(id12) != "LEGAL":
            continue

        info = await get_iins_by_bin(id12)
        bin_meta[id12] = info

        org_name = info.get("orgNameRu") or f"ЮЛ {id12}"
        legal_entities[id12] = org_name

        li = to12(info.get("leaderIIN"))
        if li:
            extra_iins.add(li)

        for fi in info.get("foundersIINs") or []:
            t = to12(fi)
            if t:
                extra_iins.add(t)

    # ---------
    # 2) Заполняем ФЛ (IIN)
    # ---------
    people_cache = load_people_cache()
    for iin in sorted(extra_iins):
        name = (people_cache.get(iin) or {}).get("name") or f"ФЛ {iin}"
        individuals[iin] = name
    save_people_cache(people_cache)

    # ---------
    # 3) Формируем results, проходя по ВСЕМ строкам файла (чтобы сохранить дубли/порядок)
    # ---------
    results: List[Dict[str, Any]] = []

    for row in records:
        id12 = to12(row.get(id_col))
        if not id12:
            continue

        typ = infer_entity_type(id12)
        
        leader_iin = None
        founders = []

        if typ == "LEGAL":
            name = legal_entities.get(id12) or f"ЮЛ {id12}"
            meta = bin_meta.get(id12) or {}
            oked = meta.get("oked")
            oked_name = meta.get("okedNameRu")
            district = meta.get("districtRu")
            city = meta.get("cityRu")
            
            # Извлекаем ИИНы для ответа
            leader_iin = to12(meta.get("leaderIIN"))
            founders = [to12(f) for f in (meta.get("foundersIINs") or []) if to12(f)]
        else:
            name = individuals.get(id12) or f"ФЛ {id12}"
            oked = None
            oked_name = None
            district = None
            city = None
            individuals[id12] = name  # если ИИН изначально был в Excel

        score, reasons = heuristic_score(id12)
        risk_level = level_from_score(score)

        results.append({
            "bin": id12,
            "name": name,
            "id": id12,
            "displayName": name,
            "entityType": typ,
            "riskScore": int(score),
            "riskLevel": risk_level,
            "reasons": reasons,
            "oked": oked,
            "okedName": oked_name,
            "okedNameRu": oked_name,
            "districtRu": district,
            "cityRu": city,
            
            # НОВЫЕ ПОЛЯ:
            "leaderIIN": leader_iin,
            "foundersIINs": founders,
            "rowData": row  # <-- Здесь лежат все остальные колонки из Excel таблицы
        })

    # ---------
    # 4) Сортировка по ОКЭД
    # ---------
    results.sort(
        key=lambda r: (
            0 if r.get("oked") else 1,
            safe_int(r.get("oked"), 999999),
            -safe_int(r.get("riskScore"), 0),
        )
    )

    LAST_RESULTS = results

    return {
        "rowsAnalyzed": len(results),
        "results": results,
        "sharedIINCount": len(extra_iins),
        "charts": build_charts(results),
        "individuals": [{"id": k, "name": v} for k, v in sorted(individuals.items())],
        "legalEntities": [{"id": k, "name": v} for k, v in sorted(legal_entities.items())],
    }


@app.get("/api/signals")
async def signals():
    agg = defaultdict(lambda: {"count": 0, "high": 0, "medium": 0, "low": 0})

    for r in LAST_RESULTS:
        district = r.get("districtRu")
        if not district:
            continue
        agg[district]["count"] += 1
        lvl = (r.get("riskLevel") or "LOW").upper()
        if lvl == "HIGH":
            agg[district]["high"] += 1
        elif lvl == "MEDIUM":
            agg[district]["medium"] += 1
        else:
            agg[district]["low"] += 1

    out = []
    for district, a in agg.items():
        level = "LOW"
        if a["high"] > 0:
            level = "HIGH"
        elif a["medium"] > 0:
            level = "MEDIUM"
        out.append({
            "id": district,
            "name": district,
            "lat": 0,
            "lng": 0,
            "level": level,
            "count": a["count"],
            "message": f"HIGH: {a['high']} | MEDIUM: {a['medium']} | LOW: {a['low']}",
        })

    return {"signals": out}


@app.get("/api/debug/last")
async def debug_last():
    return {"sample": LAST_RESULTS[:10]}