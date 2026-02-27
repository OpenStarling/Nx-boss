from __future__ import annotations

import re
import time
import io
from typing import Any, Dict, List, Optional, Set, Tuple

import pandas as pd
import requests
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware

# ===================== CONFIG =====================
GBDUL_URL = "http://192.168.0.31:8830/gbdulbybin/send-request"
REQUESTOR_BIN = "970840000277"

HEADERS = {
    "Authorization": "Basic as base64",
    "Content-Type": "application/json",
    "X-REQUEST-ID": "hackathon",
}

CONNECT_TIMEOUT = 5
READ_TIMEOUT = 25
RETRIES = 2
SLEEP_BETWEEN = 0.15

GSZ_THRESHOLD = 750_000_000
BIN_RE = re.compile(r"^\d{12}$")

# ===================== In-memory cache for drill-down =====================
ORG_CACHE: Dict[str, dict] = {}          
IIN_INDEX: Dict[str, List[str]] = {}    

# ===================== FASTAPI =====================
app = FastAPI(title="Hackathon Affiliation Checker", version="2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ===================== HELPERS =====================
def to12(value: Any) -> Optional[str]:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        try:
            s = str(int(value)).zfill(12)
        except Exception:
            return None
    else:
        s = re.sub(r"\D", "", str(value).strip())
        if not s: return None
        if len(s) < 12: s = s.zfill(12)

    return s if BIN_RE.match(s) else None


def find_header_row_df(df_raw: pd.DataFrame, max_scan_rows: int = 50) -> int:
    for i in range(min(max_scan_rows, len(df_raw))):
        row = df_raw.iloc[i].tolist()
        txt = " ".join([str(x).lower() for x in row if pd.notna(x)])
        if "бин" in txt or "bin" in txt or "иин" in txt:
            return i
    return 0


def parse_excel_bytes(file_bytes: bytes, filename: str) -> List[Tuple[str, Optional[float]]]:
    is_csv = filename.lower().endswith('.csv')
    
    try:
        if is_csv:
            # Читаем CSV с автоопределением разделителя (engine='python' решает проблему запятых и точек с запятой)
            df_raw = pd.read_csv(io.BytesIO(file_bytes), header=None, sep=None, engine='python', encoding='utf-8')
        else:
            df_raw = pd.read_excel(io.BytesIO(file_bytes), header=None)
    except UnicodeDecodeError:
        # Если кодировка русская (Windows-1251)
        if is_csv:
            df_raw = pd.read_csv(io.BytesIO(file_bytes), header=None, sep=None, engine='python', encoding='windows-1251')
    except Exception as e:
        raise ValueError(f"Не удалось прочитать файл. Ошибка: {str(e)}")

    header_row = find_header_row_df(df_raw, max_scan_rows=100)

    # Перечитываем файл с правильным заголовком
    if is_csv:
        try:
            df = pd.read_csv(io.BytesIO(file_bytes), header=header_row, sep=None, engine='python', encoding='utf-8')
        except UnicodeDecodeError:
            df = pd.read_csv(io.BytesIO(file_bytes), header=header_row, sep=None, engine='python', encoding='windows-1251')
    else:
        df = pd.read_excel(io.BytesIO(file_bytes), header=header_row)

    df.columns = [str(c).strip().lower() for c in df.columns]

    # Ищем БИН
    bin_col = next((c for c in df.columns if "бин" in c or "bin" in c or "иин" in c), None)
    if bin_col is None:
        raise ValueError(f"Не найдена колонка BIN/ИИН. Найденные колонки: {df.columns.tolist()}")

    # Ищем Сумму (в твоем файле она называется "Утвержденная Банком Сумма Лимита")
    amount_col = next((c for c in df.columns if "сумм" in c or "лимит" in c), None)

    out: List[Tuple[str, Optional[float]]] = []
    max_rows_to_process = 20 # Лимит для хакатона

    for _, row in df.iterrows():
        if len(out) >= max_rows_to_process:
            break
            
        b = to12(row.get(bin_col))
        if not b:
            continue
            
        amt = None
        if amount_col is not None:
            try:
                a = row.get(amount_col)
                if pd.notna(a):
                    clean_amt = str(a).replace(" ", "").replace(",", ".")
                    amt = float(clean_amt)
            except Exception:
                amt = None
        out.append((b, amt))

    if not out:
        raise ValueError("В файле не найдено ни одного корректного 12-значного БИН/ИИН.")
    return out


# ===================== Бизнес-логика =====================
def call_gbdul(bin_value: str) -> Tuple[Optional[dict], Optional[str]]:
    payload = {"bin": bin_value, "requestor_bin": REQUESTOR_BIN}
    last_err = None
    for attempt in range(1, RETRIES + 2):
        try:
            r = requests.post(GBDUL_URL, headers=HEADERS, json=payload, timeout=(CONNECT_TIMEOUT, READ_TIMEOUT))
            if r.status_code != 200:
                last_err = f"HTTP {r.status_code}: {r.text[:200]}"
            else:
                org = (r.json().get("data") or {}).get("organization")
                if org: return org, None
                last_err = "No organization in response"
        except Exception as e:
            last_err = f"Exception: {e}"
        time.sleep(0.3)
    return None, last_err

def org_size_name(org: dict) -> str:
    return ((org.get("statCommInfo") or {}).get("orgSize") or {}).get("nameRu") or ""

def extract_people_and_companies(org: dict) -> Tuple[Set[str], Set[str]]:
    people, companies = set(), set()
    for f in (org.get("foundersFL") or []):
        if iin := to12(f.get("IIN")): people.add(iin)
    for u in (org.get("foundersUL") or []):
        if b := to12(u.get("BIN")): companies.add(b)
    if leader_iin := to12((org.get("organizationLeader") or {}).get("IIN")): people.add(leader_iin)
    ben = (org.get("benefiziars") or {}).get("benefiziar")
    if isinstance(ben, dict) and (ben_iin := to12(ben.get("IIN"))): people.add(ben_iin)
    return people, companies

def base_risk(org: dict, amount: Optional[float]) -> Tuple[int, List[str]]:
    score = 0
    reasons = []
    if org.get("foundersUL"): score += 30; reasons.append("Есть юрлица в учредителях")
    if len(org.get("foundersFL") or []) >= 3: score += 15; reasons.append("Много физ. учредителей (>= 3)")
    size = org_size_name(org)
    if size and "круп" in size.lower(): score += 25; reasons.append(f"Крупный бизнес: {size}")
    try:
        if float(((org.get("authCapital") or {}).get("percentGov") or 0)) > 25:
            score += 30; reasons.append("Высокая доля государства")
    except Exception: pass
    if (org.get("addInfo") or {}).get("affiliated"): score += 10; reasons.append("Дочерняя организация")
    if amount and amount > GSZ_THRESHOLD: score += 20; reasons.append("Сумма > 750 млн (нужна карта ГСЗ)")
    return min(score, 100), (reasons if reasons else ["Нет явных рисков"])

def risk_level(score: int) -> str:
    if score >= 70: return "HIGH"
    if score >= 40: return "MEDIUM"
    return "LOW"


# ===================== ROUTES =====================
@app.post("/api/analyze")
async def analyze(file: UploadFile = File(...)):
    global ORG_CACHE, IIN_INDEX
    
    if not file.filename.lower().endswith((".xlsx", ".xls", ".csv")):
        raise HTTPException(status_code=400, detail="Нужен Excel (.xlsx/.xls) или .csv файл")

    file_bytes = await file.read()

    try:
        rows = parse_excel_bytes(file_bytes, file.filename)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Ошибка чтения файла: {e}")

    ORG_CACHE = {}
    IIN_INDEX = {}
    results = []
    nodes = {}
    edges = []
    bin_to_iins = {}
    iin_to_bins = {}

    ok, fail = 0, 0
    
    for idx, (b, amt) in enumerate(rows, start=1):
        print(f"[{idx}/{len(rows)}] BIN={b} amount={amt}")
        org, err = call_gbdul(b)
        
        if not org:
            print(f"  FAIL: {err}")
            fail += 1
            continue

        ok += 1
        ORG_CACHE[b] = org
        name = org.get("fullNameRu") or org.get("shortNameRu") or b
        size = org_size_name(org) or None
        score, reasons = base_risk(org, amt)

        people, companies = extract_people_and_companies(org)
        bin_to_iins[b] = people
        for iin in people: iin_to_bins.setdefault(iin, set()).add(b)

        nodes[f"C:{b}"] = {"id": f"C:{b}", "type": "company", "label": name}
        for iin in people:
            nodes[f"P:{iin}"] = {"id": f"P:{iin}", "type": "person", "label": f"IIN {iin}"}
            edges.append({"source": f"C:{b}", "target": f"P:{iin}", "rel": "PERSON"})
        for cb in companies:
            nodes[f"C:{cb}"] = {"id": f"C:{cb}", "type": "company", "label": f"BIN {cb}"}
            edges.append({"source": f"C:{b}", "target": f"C:{cb}", "rel": "OWNER_UL"})

        results.append({
            "bin": b, "amount": amt, "name": name, "orgSize": size,
            "riskScore": score, "riskLevel": risk_level(score), "reasons": reasons,
        })
        time.sleep(SLEEP_BETWEEN)

    if not results:
        raise HTTPException(status_code=502, detail="Не удалось получить данные из ГБД ЮЛ для найденных БИН.")

    shared_iin = {iin: sorted(list(bs)) for iin, bs in iin_to_bins.items() if len(bs) >= 2}
    IIN_INDEX = {iin: bins for iin, bins in shared_iin.items()}

    for r in results:
        b = r["bin"]
        max_group = 0
        for iin in bin_to_iins.get(b, set()):
            if iin in shared_iin: max_group = max(max_group, len(shared_iin[iin]))
        if max_group >= 2:
            r["riskScore"] = min(100, r["riskScore"] + 25)
            r["riskLevel"] = risk_level(r["riskScore"])
            r["reasons"].append(f"Аффилированность: общий ИИН с {max_group} компаниями реестра")

    results.sort(key=lambda x: (x["riskScore"], x["amount"] if x["amount"] is not None else -1), reverse=True)

    return {
        "rowsParsed": len(rows),
        "rowsAnalyzed": len(results),
        "ok": ok,
        "fail": fail,
        "sharedIINCount": len(shared_iin),
        "sharedIIN": shared_iin,
        "results": results,
        "graph": {"nodes": list(nodes.values()), "edges": edges}
    }

if __name__ == "__main__":
    import uvicorn
    # Запускаем именно этот файл!
    uvicorn.run(app, host="0.0.0.0", port=3001)