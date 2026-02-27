from __future__ import annotations

import os
import re
import math
from typing import Any, Dict, List, Optional, Tuple
from collections import Counter

import pandas as pd
import httpx
from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware


def to12(v: Any) -> Optional[str]:
    if v is None:
        return None
    s = str(v).strip()
    digits = re.sub(r"\D", "", s)
    if not digits:
        return None
    digits = digits[-12:].rjust(12, "0")
    return digits


def bucket_score(score: int, step: int = 10) -> str:
    score = max(0, min(100, int(score)))
    lo = (score // step) * step
    hi = min(100, lo + step)
    if lo == 100:
        return "100"
    return f"{lo}-{hi}"


def level_from_score(score: int) -> str:
    # Можно потом откалибровать пороги
    if score >= 70:
        return "HIGH"
    if score >= 40:
        return "MEDIUM"
    return "LOW"


def heuristic_score(bin12: str) -> Tuple[int, List[str]]:
    """
    Без внешних API / ИИ: простая эвристика, чтобы всегда был результат.
    Потом замените на вашу формулу/модель.
    """
    reasons: List[str] = []
    # пример: "подозрительные" BIN-ы (очень условно)
    tail = int(bin12[-2:])
    score = 25

    if tail in {0, 1, 2, 3, 4}:
        score += 25
        reasons.append("Аномальная структура идентификатора (условный признак).")

    if bin12.startswith("0"):
        score += 15
        reasons.append("BIN начинается с 0 (возможная некорректная запись/формат).")

    # немного “шума”, чтобы скор не был одинаковым
    score += (int(bin12[-1]) * 3) % 20

    score = max(0, min(100, score))
    if not reasons:
        reasons.append("Явных риск-факторов по базовой эвристике не выявлено.")
    return score, reasons


async def ollama_score(bin12: str) -> Optional[Tuple[int, str, str, int]]:
    """
    Опционально: если у вас запущен Ollama, можно получать JSON оценку от LLM.
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
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                ollama_url,
                json={"model": model, "prompt": prompt, "stream": False, "format": "json"},
            )
            resp.raise_for_status()
            data = resp.json()
            raw = data.get("response", "")
            # на некоторых моделях бывает <think>... — срежем
            raw = re.sub(r"[\s\S]*?</think>", "", raw)
            j = httpx.Response(200, content=raw).json()

        score = int(j.get("score", 0))
        risk_level = str(j.get("risk_level", "LOW")).upper()
        reason = str(j.get("reason", "")).strip() or "Причина не указана."
        big_biz = int(j.get("big_biz_chance", 0))
        score = max(0, min(100, score))
        if risk_level not in {"LOW", "MEDIUM", "HIGH"}:
            risk_level = level_from_score(score)
        big_biz = max(0, min(100, big_biz))
        return score, risk_level, reason, big_biz
    except Exception:
        return None


def build_charts(results: List[Dict[str, Any]]) -> Dict[str, Any]:
    # Подсчеты по уровням
    level_counts = Counter([r.get("riskLevel") for r in results])
    risk_level_counts = [
        {"name": "LOW", "value": int(level_counts.get("LOW", 0))},
        {"name": "MEDIUM", "value": int(level_counts.get("MEDIUM", 0))},
        {"name": "HIGH", "value": int(level_counts.get("HIGH", 0))},
    ]

    # Гистограмма по скору
    hist = Counter([bucket_score(int(r.get("riskScore", 0))) for r in results])
    # упорядочим красиво
    order = [f"{i}-{i+10}" for i in range(0, 100, 10)] + ["100"]
    score_histogram = [{"bucket": k, "count": int(hist.get(k, 0))} for k in order]

    # Топ риск
    top_risk = sorted(results, key=lambda x: int(x.get("riskScore", 0)), reverse=True)[:10]

    return {
        "riskLevelCounts": risk_level_counts,
        "scoreHistogram": score_histogram,
        "topRisk": top_risk,
    }


app = FastAPI(title="NX-BOSS Python Backend", version="1.0.0")

# Для dev-режима можно CORS разрешить, но лучше использовать Vite proxy (см. ниже)
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

    # Читаем excel (1 лист)
    df = pd.read_excel(content)
    # Нормализуем названия колонок
    cols = {c: str(c).strip().lower() for c in df.columns}
    df.rename(columns=cols, inplace=True)

    # Популярные варианты названий
    bin_col = None
    for cand in ["бин", "bin", "бiн", "business_id"]:
        if cand in df.columns:
            bin_col = cand
            break

    if not bin_col:
        # вернем 0, чтобы фронт показал инструкцию (как у вас сейчас)
        return {"rowsAnalyzed": 0, "results": [], "sharedIINCount": 0, "charts": {}}

    results: List[Dict[str, Any]] = []

    for _, row in df.iterrows():
        bin12 = to12(row.get(bin_col))
        if not bin12:
            continue

        # Name (если есть)
        name = None
        for nc in ["наименование", "name", "company", "организация", "fullnameru"]:
            if nc in df.columns:
                v = row.get(nc)
                if v is not None and str(v).strip():
                    name = str(v).strip()
                    break

        # 1) Попытка LLM (если доступен), 2) иначе эвристика
        llm = await ollama_score(bin12)
        if llm:
            score, risk_level, reason, big_biz = llm
            reasons = [reason]
        else:
            score, reasons = heuristic_score(bin12)
            risk_level = level_from_score(score)
            big_biz = int(min(100, max(0, score + 10)))  # условный показатель

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