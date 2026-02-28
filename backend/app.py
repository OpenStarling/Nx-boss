from __future__ import annotations
from iin_service import get_iins_by_bin
import io
import os
import re
import json
import asyncio
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from collections import Counter, defaultdict

import pandas as pd
import httpx
from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware


# ============================================================
# SETTINGS (env)
# ============================================================
GBDUL_BIN_URL = os.getenv("GBDUL_BIN_URL", "").strip()
GBDUL_IIN_URL = os.getenv("GBDUL_IIN_URL", "").strip()

GBDUL_REQUESTOR_BIN = os.getenv("GBDUL_REQUESTOR_BIN", "970840000277").strip()
GBDUL_BASIC = os.getenv("GBDUL_BASIC", "").strip()
GBDUL_CONCURRENCY = int(os.getenv("GBDUL_CONCURRENCY", "25"))

CACHE_PROFILES_PATH = Path("cache_profiles.json")
LAST_RESULTS: List[Dict[str, Any]] = []


# ============================================================
# REGION CENTERS
# ============================================================
REGION_CENTERS = {
    "Акмолинская область": (51.169392, 71.449074),
    "Актюбинская область": (50.283937, 57.166978),
    "Алматинская область": (43.238949, 76.889709),
    "Атырауская область": (47.094495, 51.923837),
    "Восточно-Казахстанская область": (49.948296, 82.628459),
    "Жамбылская область": (42.900000, 71.366700),
    "Западно-Казахстанская область": (51.222300, 51.370000),
    "Карагандинская область": (49.806405, 73.085531),
    "Костанайская область": (53.214350, 63.624630),
    "Кызылординская область": (44.848800, 65.482300),
    "Мангистауская область": (43.653500, 51.197500),
    "Павлодарская область": (52.287303, 76.967402),
    "Северо-Казахстанская область": (54.872800, 69.143000),
    "Туркестанская область": (42.300000, 69.600000),
    "Улытауская область": (47.800000, 67.700000),
    "Абайская область": (50.411110, 80.227500),
    "Жетысуская область": (45.015600, 78.373900),

    "город Астана": (51.169392, 71.449074),
    "город Алматы": (43.238949, 76.889709),
    "город Шымкент": (42.341700, 69.590100),

    # старое имя
    "город Нур-Султан": (51.169392, 71.449074),
}


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
    if not id12 or len(id12) != 12:
        return "UNKNOWN"
    try:
        mm = int(id12[2:4])
        dd = int(id12[4:6])
        s = id12[6]
        # эвристика ИИН
        if 1 <= mm <= 12 and 1 <= dd <= 31 and s in "123456":
            return "INDIVIDUAL"
        return "LEGAL"
    except Exception:
        return "UNKNOWN"

def safe_int(x: Any, default: int = 0) -> int:
    try:
        s = re.sub(r"\D", "", str(x or ""))
        return int(s) if s else default
    except Exception:
        return default

def normalize_region(x: Any) -> Optional[str]:
    s = _norm(x)
    if not s:
        return None
    s = s.replace("г.", "город ").replace("Г.", "город ")
    s = re.sub(r"\s+", " ", s).strip()
    return s

def _auth_headers() -> Dict[str, str]:
    h = {"Content-Type": "application/json"}
    if GBDUL_BASIC:
        h["Authorization"] = GBDUL_BASIC
    return h

def _pick_first(d: dict, keys: List[str]) -> Optional[str]:
    for k in keys:
        v = d.get(k)
        if v is not None and str(v).strip():
            return str(v).strip()
    return None

def _get_nested(obj: dict, *keys: str) -> Any:
    cur: Any = obj
    for k in keys:
        if not isinstance(cur, dict):
            return None
        cur = cur.get(k)
    return cur

def _find_first_dict(obj: dict, candidates: List[Tuple[str, ...]]) -> dict:
    for path in candidates:
        got = _get_nested(obj, *path)
        if isinstance(got, dict):
            return got
    return {}


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
# Cache
# ============================================================
def load_profiles_cache() -> Dict[str, Dict[str, Any]]:
    if CACHE_PROFILES_PATH.exists():
        try:
            return json.loads(CACHE_PROFILES_PATH.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}

def save_profiles_cache(cache: Dict[str, Dict[str, Any]]) -> None:
    try:
        CACHE_PROFILES_PATH.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")
    except Exception:
        pass


# ============================================================
# Parse profiles (ЮЛ/ФЛ)
# ============================================================
def parse_legal_profile(j: dict) -> Dict[str, Any]:
    # организация
    org = _find_first_dict(j, [("data", "organization"), ("organization",), ("data", "org"), ("org",)])
    name = _pick_first(org, ["fullNameRu", "fullNameKz", "fullNameEn", "shortNameRu", "shortNameKz", "nameRu", "nameKz", "name", "title"])

    # activity / OKED
    activity = _find_first_dict(j, [
        ("data", "organization", "activity"),
        ("organization", "activity"),
        ("data", "activity"),
        ("activity",),
    ])
    oked = activity.get("OKED") or activity.get("oked")
    oked_name_ru = activity.get("activityNameRu") or activity.get("nameRu")

    # address
    addr = _find_first_dict(j, [
        ("data", "organization", "address"),
        ("organization", "address"),
        ("data", "address"),
        ("address",),
    ])
    districtRu = addr.get("districtRu") or addr.get("districtKz")
    regionRu = addr.get("regionRu") or addr.get("regionKz")
    cityRu = addr.get("cityRu") or addr.get("cityKz")

    # form of law
    formOfLaw = _find_first_dict(j, [
        ("data", "organization", "formOfLaw"),
        ("organization", "formOfLaw"),
        ("data", "formOfLaw"),
        ("formOfLaw",),
    ])
    formOfLawRu = formOfLaw.get("nameRu") or formOfLaw.get("nameKz")

    # orgSize
    stat = _find_first_dict(j, [
        ("data", "organization", "statCommInfo"),
        ("organization", "statCommInfo"),
        ("data", "statCommInfo"),
        ("statCommInfo",),
    ])
    orgSize = _find_first_dict(stat, [("orgSize",)])
    orgSizeRu = orgSize.get("nameRu") or orgSize.get("nameKz")

    # ✅ ИИНы внутри ЮЛ (то, чего не хватало)
    leader = org.get("organizationLeader") or {}
    leader_iin = leader.get("IIN") or leader.get("iin")

    founders_fl = org.get("foundersFL") or []
    founders_iins: List[str] = []
    for f in founders_fl:
        if isinstance(f, dict):
            iin = f.get("IIN") or f.get("iin")
            if iin:
                founders_iins.append(iin)

    return {
        "name": name,
        "oked": oked,
        "okedNameRu": oked_name_ru,
        "districtRu": normalize_region(districtRu),
        "regionRu": normalize_region(regionRu),
        "cityRu": cityRu,
        "formOfLawRu": formOfLawRu,
        "orgSizeRu": orgSizeRu,

        # ✅ добавили
        "leaderIIN": leader_iin,
        "foundersIINs": founders_iins,
    }

def parse_person_profile(j: dict) -> Dict[str, Any]:
    data = j.get("data") if isinstance(j.get("data"), dict) else {}

    name = None
    for boxpath in [("data", "person"), ("data", "individual"), ("person",), ("individual",)]:
        box = _get_nested(j, *boxpath)
        if isinstance(box, dict):
            name = _pick_first(box, ["fullNameRu", "fullNameKz", "fullNameEn", "fio", "fullName", "name"])
            if name:
                break

    if not name:
        if isinstance(data, dict):
            name = _pick_first(data, ["fullNameRu", "fio", "fullName", "name"])
        if not name:
            name = _pick_first(j, ["fio", "fullName", "name"])

    addr = _find_first_dict(j, [("data", "address"), ("address",)])
    districtRu = addr.get("districtRu") or addr.get("districtKz")
    regionRu = addr.get("regionRu") or addr.get("regionKz")
    cityRu = addr.get("cityRu") or addr.get("cityKz")

    return {
        "name": name,
        "districtRu": normalize_region(districtRu),
        "regionRu": normalize_region(regionRu),
        "cityRu": cityRu,
    }


# ============================================================
# Fetch profiles
# ============================================================
async def gbdul_fetch_legal(bin12: str) -> Optional[Dict[str, Any]]:
    if not GBDUL_BIN_URL:
        return None
    try:
        async with httpx.AsyncClient(timeout=25.0) as client:
            r = await client.post(
                GBDUL_BIN_URL,
                json={"bin": bin12, "requestor_bin": GBDUL_REQUESTOR_BIN},
                headers=_auth_headers(),
            )
            r.raise_for_status()
            j = r.json()
        return parse_legal_profile(j)
    except Exception:
        return None

async def gbdul_fetch_person(iin12: str) -> Optional[Dict[str, Any]]:
    if not GBDUL_IIN_URL:
        return None
    try:
        async with httpx.AsyncClient(timeout=25.0) as client:
            r = await client.post(
                GBDUL_IIN_URL,
                json={"iin": iin12, "requestor_bin": GBDUL_REQUESTOR_BIN},
                headers=_auth_headers(),
            )
            r.raise_for_status()
            j = r.json()
        return parse_person_profile(j)
    except Exception:
        return None

async def batch_fetch_profiles(ids: List[str], concurrency: int) -> Dict[str, Dict[str, Any]]:
    sem = asyncio.Semaphore(max(1, concurrency))
    out: Dict[str, Dict[str, Any]] = {}

    async def one(x: str):
        async with sem:
            typ = infer_entity_type(x)
            prof = await (gbdul_fetch_legal(x) if typ == "LEGAL" else gbdul_fetch_person(x))
            if prof:
                out[x] = prof

    await asyncio.gather(*(one(i) for i in ids))
    return out


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
app = FastAPI(title="NX-BOSS Backend", version="8.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/api/get-iin-by-bin")
async def api_get_iin_by_bin(bin: str):
    return await get_iins_by_bin(bin)

@app.get("/api/health")
async def health():
    return {"ok": True}

@app.post("/api/analyze")
async def analyze(file: UploadFile = File(...)):
    global LAST_RESULTS

    content = await file.read()
    df = parse_excel_auto_header(content, scan_rows=30)
    df.columns = [_norm_low(c) for c in df.columns]

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

    ids_all = [to12(v) for v in df[id_col].tolist()]
    ids_all = [x for x in ids_all if x]
    unique_ids = sorted(set(ids_all))

    # 1) сначала получаем профили по тем id, которые пришли из Excel
    cache = load_profiles_cache()
    missing = [i for i in unique_ids if i not in cache]
    if missing:
        fetched = await batch_fetch_profiles(missing, concurrency=GBDUL_CONCURRENCY)
        cache.update(fetched)
        save_profiles_cache(cache)

    # 2) ✅ теперь вытаскиваем ИИНы из ЮЛ (leader + founders) и докачиваем профили ФЛ
    extra_iins: set[str] = set()
    for id12 in unique_ids:
        if infer_entity_type(id12) != "LEGAL":
            continue
        prof = cache.get(id12) or {}
        li = to12(prof.get("leaderIIN"))
        if li:
            extra_iins.add(li)
        for fi in (prof.get("foundersIINs") or []):
            t = to12(fi)
            if t:
                extra_iins.add(t)

    missing_extra = [i for i in sorted(extra_iins) if i not in cache]
    if missing_extra:
        fetched_extra = await batch_fetch_profiles(missing_extra, concurrency=GBDUL_CONCURRENCY)
        cache.update(fetched_extra)
        save_profiles_cache(cache)

    # 3) формируем results + списки individuals/legalEntities
    results: List[Dict[str, Any]] = []
    individuals: Dict[str, str] = {}
    legal_entities: Dict[str, str] = {}

    for id12 in ids_all:
        typ = infer_entity_type(id12)
        prof = cache.get(id12) or {}

        name = prof.get("name")
        if not name:
            name = ("ФЛ " if typ == "INDIVIDUAL" else "ЮЛ ") + id12

        score, reasons = heuristic_score(id12)
        risk_level = level_from_score(score)

        res_item = {
            # ✅ новый формат (ваш текущий UI)
            "bin": id12,
            "name": name,

            # ✅ старый формат (чтобы ничего не слетало)
            "id": id12,
            "displayName": name,

            "entityType": typ,
            "riskScore": int(score),
            "riskLevel": risk_level,
            "reasons": reasons,

            # ✅ OKED
            "oked": prof.get("oked"),
            "okedName": prof.get("okedNameRu"),
            "okedNameRu": prof.get("okedNameRu"),

            # ✅ адреса
            "districtRu": normalize_region(prof.get("districtRu")),
            "regionRu": normalize_region(prof.get("regionRu")),
            "cityRu": prof.get("cityRu"),

            # доп
            "orgSizeRu": prof.get("orgSizeRu"),
            "formOfLawRu": prof.get("formOfLawRu"),
        }

        results.append(res_item)

        if typ == "INDIVIDUAL":
            individuals[id12] = name
        elif typ == "LEGAL":
            legal_entities[id12] = name

    # ✅ добавляем ФЛ из leader/founders в individuals, даже если их не было в Excel
    for iin12 in sorted(extra_iins):
        prof = cache.get(iin12) or {}
        nm = prof.get("name") or ("ФЛ " + iin12)
        individuals[iin12] = nm

    # 4) ✅ сортировка по ОКЭД (числом), затем по риску
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
        "sharedIINCount": 0,
        "charts": build_charts(results),
        "individuals": [{"id": k, "name": v} for k, v in individuals.items()],
        "legalEntities": [{"id": k, "name": v} for k, v in legal_entities.items()],
    }

@app.get("/api/signals")
async def signals():
    agg = defaultdict(lambda: {"count": 0, "high": 0, "medium": 0, "low": 0})

    for r in LAST_RESULTS:
        district = r.get("districtRu") or r.get("regionRu")
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
        if district not in REGION_CENTERS:
            continue

        lat, lng = REGION_CENTERS[district]
        level = "LOW"
        if a["high"] > 0:
            level = "HIGH"
        elif a["medium"] > 0:
            level = "MEDIUM"

        out.append({
            "id": district,
            "name": district,
            "lat": lat,
            "lng": lng,
            "level": level,
            "count": a["count"],
            "message": f"HIGH: {a['high']} | MEDIUM: {a['medium']} | LOW: {a['low']}",
        })

    return {"signals": out}

@app.get("/api/debug/last")
async def debug_last():
    return {"sample": LAST_RESULTS[:10]}