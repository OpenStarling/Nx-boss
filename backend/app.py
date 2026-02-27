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
# ENV (ВАЖНО)
# =========================
# ЮЛ (БИН) — точно есть у вас в репо
GBDUL_BIN_URL = os.getenv("GBDUL_BIN_URL", "").strip()     # пример: http://192.168.0.31:8830/gbdulbybin/send-request
# ФЛ (ИИН) — возможно есть другой endpoint. Если нет — оставьте пустым.
GBDUL_IIN_URL = os.getenv("GBDUL_IIN_URL", "").strip()     # пример: http://192.168.0.31:8830/gbdulbyiin/send-request

GBDUL_REQUESTOR_BIN = os.getenv("GBDUL_REQUESTOR_BIN", "970840000277").strip()
GBDUL_AUTH_BASIC = os.getenv("GBDUL_BASIC", "").strip()    # пример: Basic xxxxxxx (base64 login:password)

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

def to12(v: Any) -> Optional[str]:
    digits = re.sub(r"\D", "", str(v or ""))
    if not digits:
        return None
    return digits[-12:].rjust(12, "0")

def infer_entity_type(id12: str) -> str:
    """
    Эвристика: если первые 6 цифр похожи на дату и 7-я 1..6 -> ИИН
    иначе -> БИН
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
# Excel parsing (robust header)
# =========================
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

    # fallback by values
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
# GBDUL API parsing (важно!)
# =========================
def _pick_first(d: dict, keys: List[str]) -> Optional[str]:
    for k in keys:
        v = d.get(k)
        if v is not None and str(v).strip():
            return str(v).strip()
    return None

def parse_legal_name_from_gbdul(j: dict) -> Optional[str]:
    """
    По вашей Node-логике основной кейс:
    data.organization.fullNameRu
    """
    data = j.get("data") or {}
    org = data.get("organization") or {}
    return _pick_first(org, ["fullNameRu", "fullNameKz", "fullNameEn", "nameRu", "nameKz", "nameEn", "name", "title"])

def parse_person_name_from_gbdul(j: dict) -> Optional[str]:
    """
    ФЛ: формат может отличаться. Пробуем типовые варианты.
    """
    data = j.get("data") or {}

    # 1) часто бывает data.person
    person = data.get("person") or {}
    nm = _pick_first(person, ["fullNameRu", "fullNameKz", "fullNameEn", "fio", "fullName", "name"])
    if nm:
        return nm

    # 2) иногда бывает data.individual / data.human
    for key in ["individual", "human", "client"]:
        box = data.get(key)
        if isinstance(box, dict):
            nm2 = _pick_first(box, ["fullNameRu", "fio", "fullName", "name"])
            if nm2:
                return nm2

    # 3) или прямо на верхнем уровне
    nm3 = _pick_first(j, ["fio", "fullName", "full_name", "name"])
    return nm3


# =========================
# GBDUL requests (как в Node)
# =========================
def _auth_headers() -> Dict[str, str]:
    h = {"Content-Type": "application/json"}
    if GBDUL_AUTH_BASIC:
        h["Authorization"] = GBDUL_AUTH_BASIC
    return h

async def gbdul_lookup_legal(bin12: str) -> Optional[str]:
    if not GBDUL_BIN_URL:
        return None
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.post(
                GBDUL_BIN_URL,
                json={"bin": bin12, "requestor_bin": GBDUL_REQUESTOR_BIN},
                headers=_auth_headers(),
            )
            r.raise_for_status()
            j = r.json()
        return parse_legal_name_from_gbdul(j)
    except Exception:
        return None

async def gbdul_lookup_person(iin12: str) -> Optional[str]:
    """
    Работает ТОЛЬКО если вы укажете GBDUL_IIN_URL.
    ВНИМАНИЕ: тело запроса может быть другим — если ваш endpoint ждёт {"iin": ...},
    поменяйте json ниже.
    """
    if not GBDUL_IIN_URL:
        return None
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.post(
                GBDUL_IIN_URL,
                json={"iin": iin12, "requestor_bin": GBDUL_REQUESTOR_BIN},
                headers=_auth_headers(),
            )
            r.raise_for_status()
            j = r.json()
        return parse_person_name_from_gbdul(j)
    except Exception:
        return None


async def batch_lookup(ids: List[str], concurrency: int) -> Dict[str, str]:
    sem = asyncio.Semaphore(max(1, concurrency))
    out: Dict[str, str] = {}

    async def one(x: str):
        async with sem:
            typ = infer_entity_type(x)
            if typ == "LEGAL":
                nm = await gbdul_lookup_legal(x)
            else:
                nm = await gbdul_lookup_person(x)
            if nm:
                out[x] = nm

    await asyncio.gather(*(one(i) for i in ids))
    return out


# =========================
# Charts (быстро, без LLM)
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
    # быстрый демо-скоринг (не влияет на имена)
    score = 50 + (int(id12[-1]) * 3) % 30
    score = max(0, min(100, score))
    return score, ["Скоринг демо-режим."]

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
app = FastAPI(title="NX-BOSS Backend", version="4.0.0")
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

    # уникальные ID
    unique_ids = sorted({to12(v) for v in df[id_col].tolist() if to12(v)})

    # cache + fetch missing
    cache = load_cache()
    missing = [i for i in unique_ids if i not in cache]

    if missing:
        fetched = await batch_lookup(missing, concurrency=GBDUL_CONCURRENCY)
        cache.update(fetched)
        save_cache(cache)

    names_map = cache

    results: List[Dict[str, Any]] = []
    individuals: Dict[str, str] = {}
    legal_entities: Dict[str, str] = {}

    for v in df[id_col].tolist():
        id12 = to12(v)
        if not id12:
            continue

        entityType = infer_entity_type(id12)
        name = names_map.get(id12)

        # fallback, если API не вернул имя (или нет IIN endpoint)
        if not name:
            name = ("ФЛ " if entityType == "INDIVIDUAL" else "ЮЛ ") + id12

        score, reasons = heuristic_score(id12)
        riskLevel = level_from_score(score)

        results.append({
            "id": id12,
            "entityType": entityType,     # INDIVIDUAL | LEGAL
            "displayName": name,          # реальное имя/наименование
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