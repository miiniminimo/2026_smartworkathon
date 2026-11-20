"""티링크 홍보 콘텐츠 메이커 핵심 로직: 자료 추출 → 차별점 분석 → 사진 기반 생성 → 가이드라인 검수 → 자동 수정."""
import base64
import html
import io
import json
import os
import re
import unicodedata
import zipfile

from guideline import (CONDITIONS, FOOTER, FOOTER_TEXT, MISSION1_KEYWORDS, MISSIONS, REQUIRED_KEYWORDS,
                       guideline_prompt_text)

DEFAULT_MODEL = os.environ.get("OPENAI_MODEL", "gpt-6.1-sol")
AD_NOTICE = "※ 이 글은 티링크로부터 제품 정보를 제공받아 작성했습니다."


# ---------------------------------------------------------------- 자료 글자 추출
def extract_pages(name: str, data: bytes) -> list[dict]:
    """파일 하나를 [{doc, page, text}]로. pptx=슬라이드, pdf=쪽, xlsx=시트."""
    name = unicodedata.normalize("NFC", name)  # macOS 파일 이름은 한글 자모가 분리(NFD)되어 있음
    low = name.lower()
    if low.endswith(".pptx"):
        return _pptx(name, data)
    if low.endswith(".pdf"):
        return _pdf(name, data)
    if low.endswith(".xlsx"):
        return _xlsx(name, data)
    if low.endswith((".txt", ".md")):
        return [{"doc": name, "page": 1, "text": data.decode("utf-8", "ignore")}]
    return []


def _pptx(name, data):
    z = zipfile.ZipFile(io.BytesIO(data))
    slides = sorted((n for n in z.namelist() if re.fullmatch(r"ppt/slides/slide\d+\.xml", n)),
                    key=lambda n: int(re.findall(r"\d+", n)[0]))
    out = []
    for n in slides:
        x = z.read(n).decode("utf-8", "ignore")
        paras = ["".join(html.unescape(t) for t in re.findall(r"<a:t>([^<]*)</a:t>", p))
                 for p in re.findall(r"<a:p>(.*?)</a:p>", x, re.S)]
        text = "\n".join(p.strip() for p in paras if p.strip())
        if text:
            out.append({"doc": name, "page": int(re.findall(r"\d+", n)[0]), "text": text})
    return out


def _pdf(name, data):
    try:
        import pymupdf as fitz  # 한글 추출이 가장 안정적
        doc = fitz.open(stream=data, filetype="pdf")
        texts = [p.get_text() for p in doc]
    except ImportError:
        from pypdf import PdfReader
        texts = [p.extract_text() or "" for p in PdfReader(io.BytesIO(data)).pages]
    return [{"doc": name, "page": i + 1, "text": t.strip()} for i, t in enumerate(texts) if t.strip()]


def _xlsx(name, data):
    z = zipfile.ZipFile(io.BytesIO(data))
    ss = []
    if "xl/sharedStrings.xml" in z.namelist():
        x = z.read("xl/sharedStrings.xml").decode("utf-8", "ignore")
        ss = [html.unescape("".join(re.findall(r"<t[^>]*>([^<]*)</t>", si))) for si in re.findall(r"<si>(.*?)</si>", x, re.S)]
    out = []
    sheets = sorted((n for n in z.namelist() if re.fullmatch(r"xl/worksheets/sheet\d+\.xml", n)),
                    key=lambda n: int(re.findall(r"\d+", n)[0]))
    for i, n in enumerate(sheets, 1):
        x = z.read(n).decode("utf-8", "ignore")
        vals = []
        for attrs, inner in re.findall(r"<c ([^>]*?)(?:/>|>(.*?)</c>)", x, re.S):
            v = re.search(r"<v>([^<]*)</v>", inner or "")
            if 't="s"' in attrs and v:
                vals.append(ss[int(v.group(1))])
            elif v:
                vals.append(v.group(1))
        out.append({"doc": name, "page": i, "text": "\n".join(vals)})
    return out


def _norm(s: str) -> str:
    return re.sub(r"\s+", "", s or "")


def corpus_text(pages: list[dict], limit: int = 120_000) -> str:
    return "\n\n".join(f"[문서: {p['doc']} | 쪽: {p['page']}]\n{p['text']}" for p in pages)[:limit]


# ---------------------------------------------------------------- OpenAI 호출
def ask_json(system: str, user_content, model: str | None = None) -> dict:
    from openai import OpenAI
    r = OpenAI().chat.completions.create(
        model=model or DEFAULT_MODEL,
        response_format={"type": "json_object"},
        messages=[{"role": "system", "content": system}, {"role": "user", "content": user_content}],
    )
    return json.loads(r.choices[0].message.content)


def image_part(data: bytes) -> dict:
    from PIL import Image
    img = Image.open(io.BytesIO(data)).convert("RGB")
    img.thumbnail((1280, 1280))
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=85)
    return {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()}}


# ---------------------------------------------------------------- ① 차별점 분석
def analyze_differentiators(pages: list[dict], model: str | None = None) -> list[dict]:
    system = "너는 B2B 통신·콜센터 솔루션 마케팅 분석가다. 주어진 자료에 있는 사실만 쓰고, JSON으로만 답한다."
    user = (
        "아래 제품 자료에서 '티링크 비즈레코딩'의 기술 차별점을 6~8개 뽑아라.\n"
        '각 항목 형식: {"차별점": "15자 이내", "설명": "한두 문장", "고객혜택": "고객이 얻는 것 한 문장", '
        '"근거": [{"문서": "문서명", "쪽": 숫자, "인용": "자료 원문에서 글자 그대로 복사한 10~40자"}]}\n'
        "규칙: 인용은 원문 글자를 바꾸지 말고 그대로 복사한다. 자료에 없는 수치·기능은 쓰지 않는다.\n"
        '전체 형식: {"items": [...]}\n\n' + corpus_text(pages)
    )
    items = ask_json(system, user, model).get("items", [])
    return verify_quotes(items, pages)


def verify_quotes(items: list[dict], pages: list[dict]) -> list[dict]:
    """AI가 댄 인용이 실제 자료에 있는지 코드로 대조. 다른 쪽에서 찾으면 쪽 번호를 바로잡는다."""
    index = {(p["doc"], int(p["page"])): _norm(p["text"]) for p in pages}
    for it in items:
        for ev in it.get("근거", []):
            q = _norm(ev.get("인용", ""))
            hits = [k for k, t in index.items() if q and q in t]
            claimed = (ev.get("문서"), _to_int(ev.get("쪽")))
            ev["확인"] = bool(hits)
            if hits and claimed not in hits:
                ev["문서"], ev["쪽"] = hits[0]
                ev["쪽수정"] = True
        it["근거확인"] = any(ev.get("확인") for ev in it.get("근거", []))
    return items


def _to_int(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


# ---------------------------------------------------------------- ② 사진 기반 콘텐츠 생성
def generate_content(photos: list[bytes], items: list[dict], model: str | None = None, customer: str = "",
                     pages: list[dict] | None = None) -> dict:
    facts = [{k: it.get(k) for k in ("차별점", "설명", "고객혜택")} for it in items if it.get("근거확인")]
    n = len(photos)
    target = ""
    if customer.strip():
        cases = [p for p in (pages or []) if re.search(r"구축|납품|제공|사례|고객사", p["text"])][:8]
        target = f"""
[대상 고객사 정보 — 이 고객사에게 보낼 맞춤 버전으로 쓴다]
{customer.strip()}
[자료 속 도입 사례 원문 — 비슷한 업종 사례는 여기 있는 것만 인용한다]
{corpus_text(cases, limit=6000)}
[맞춤 규칙] 업종·규모·통화 환경에 맞는 장면과 예시를 고른다. 고객사의 니즈를 단정하지 않는다("~하실 수 있습니다", "~한 경우라면"). 확인되지 않은 니즈는 "questions"에 미팅에서 확인할 질문 3개로 넣는다.
"""
    n = len(photos)
    text = f"""현장 사진 {n}장(순서대로 사진1~사진{n})과 검증된 기술 차별점으로 티링크 비즈레코딩 홍보 콘텐츠를 만들어라.

{guideline_prompt_text()}

[검증된 기술 차별점 — 숫자·기능은 이 목록과 가이드라인에 있는 것만 쓴다]
{json.dumps(facts, ensure_ascii=False, indent=1)}

[작성 규칙]
1. 먼저 사진마다 보이는 장면을 한 문장으로 설명하고, 그 장면에 가장 잘 맞는 차별점 하나를 연결한다.
2. 네이버 블로그 리뷰 글: 1,800~2,600자, 친근한 존댓말. 제목에 필수 키워드 3개와 '티링크 비즈레코딩'을 넣고, 첫 문단에 '{"', '".join(MISSION1_KEYWORDS)}'를 자연스럽게 모두 넣는다.
3. 본문은 추천 본문 구성 5단계를 소제목으로 따른다. 사진은 본문에서 어울리는 위치에 '[사진N]'을 한 줄로 넣는다.
4. 미션 9의 화면(휴대폰 통화 화면 → 인터넷전화 녹취 목록 → AI 통화요약 → 직원별 통계 → 종합 리포트)은 이 순서로 소개하고, 맞는 사진이 없으면 그 자리에 '[이미지 필요: 화면 이름]'을 한 줄로 넣는다.
5. 사진과 자료에 없는 체험(고객사 이름, 사용 기간, 성과 수치)은 지어내지 말고 '[직접 입력: 무엇]'으로 남긴다.
6. 결론 문단에 '영업 활동을 자동으로 기록하고 경영에 필요한 정보로 정리해 주는 기업용 영업관리 솔루션'이라는 표현을 그대로 넣는다.
7. 결론 다음 줄에 '우리 회사의 휴대폰·사무실 전화 환경으로 데모를 요청해 보세요.' 한 문장을 넣고, 본문 맨 끝에 하단 필수 문구를 그대로 넣은 뒤 그 아래에 '{AD_NOTICE}'를 넣는다.
8. 인스타그램 카드뉴스 5장: 장마다 제목 16자 이내, 문구 50자 이내. 1장은 고객이 실제로 던질 업무 질문(예: 어제 외근 중 받은 견적 요청, 오늘 다른 직원이 어디서 찾나요?), 2~4장은 사진 장면에 맞는 차별점, 5장은 '우리 팀 전화 환경으로 데모 요청'과 상담 문의(1877-3836).
9. 제품 적용 조건을 지킨다. PC폰 녹음을 말할 때는 같은 문단에 '삼성 070 계정' 조건을 함께 쓴다.
{target}
형식: {{"사진설명": [{{"사진": 1, "장면": "...", "연결차별점": "..."}}], "title": "...", "body": "...", "cards": [{{"제목": "...", "문구": "..."}}], "questions": ["고객사 정보가 있을 때만"]}}"""
    system = "너는 B2B 소프트웨어 브랜드의 네이버 블로그·인스타그램 콘텐츠 에디터다. 사실만 쓰고 JSON으로만 답한다."
    return ask_json(system, [{"type": "text", "text": text}] + [image_part(p) for p in photos], model)


# ---------------------------------------------------------------- ③ 가이드라인 검수
def code_check(title: str, body: str) -> list[dict]:
    full = f"{title}\n{body}"
    paras = [p.strip() for p in body.split("\n") if p.strip() and not p.strip().startswith(("[사진", "[이미지", "#"))]
    first = paras[0] if paras else ""
    res = []
    for i, kw in enumerate(REQUIRED_KEYWORDS, 1):
        where = [w for w, ok in (("제목", kw in title), ("본문", kw in body)) if not ok]
        res.append(_r(f"K{i}", f"필수 키워드 '{kw}' 제목·본문 포함", not where, f"{'·'.join(where)}에 없음" if where else "포함"))
    for mid, desc, mode, groups in MISSIONS:
        if mode != "code":
            continue
        if mid == "M1":
            miss = [k for k in MISSION1_KEYWORDS if k not in f"{title}\n{first}"]
            if "티링크 비즈레코딩" not in title:
                miss.insert(0, "제목의 '티링크 비즈레코딩'")
            res.append(_r(mid, desc, not miss, f"없음: {', '.join(miss)}" if miss else "4개 모두 포함"))
        elif mid == "M10":
            tail = body[int(len(body) * 0.6):]
            ok = "기업용 영업관리 솔루션" in tail
            res.append(_r(mid, desc, ok, "결론부에 포함" if ok else "결론부(본문 뒤 40%)에 '기업용 영업관리 솔루션' 없음"))
        else:
            miss = [g[0] for g in groups if not any(x in full for x in g)]
            res.append(_r(mid, desc, not miss, f"빠진 내용: {', '.join(miss)}" if miss else "모두 포함"))
    for fid, desc, needles in FOOTER:
        ok = all(n in body for n in needles)
        res.append(_r(fid, f"하단 {desc}", ok, "포함" if ok else "없음"))
    return res


def _r(i, item, ok, why):
    return {"id": i, "항목": item, "통과": bool(ok), "판정": "코드", "사유": why}


def ai_check(title: str, body: str, model: str | None = None) -> list[dict]:
    ai_missions = [(m, d) for m, d, mode, _ in MISSIONS if mode == "ai"]
    user = (
        "아래 블로그 글이 각 미션을 충족하는지 엄격하게 판정하라. "
        '미션마다 {"통과": true/false, "인용": "판정 근거가 된 본문 문장을 글자 그대로(없으면 빈 문자열)", "사유": "한 문장"}. '
        '형식: {"M5": {...}, ...}\n미션:\n' + "\n".join(f"{m}: {d}" for m, d in ai_missions)
        + f"\n\n[제목]\n{title}\n[본문]\n{body}"
    )
    out = ask_json("너는 브랜드 가이드라인 검수자다. JSON으로만 답한다.", user, model)
    res = []
    nb = _norm(f"{title}\n{body}")
    for m, d in ai_missions:
        o = out.get(m, {}) or {}
        ok = bool(o.get("통과"))
        why = o.get("사유", "")
        if ok and _norm(o.get("인용", "")) not in nb:  # 인용이 본문에 없으면 통과로 치지 않는다
            ok, why = False, "AI 인용이 본문과 일치하지 않음"
        res.append({"id": m, "항목": d, "통과": ok, "판정": "AI", "사유": why, "인용": o.get("인용", "")})
    return res


NUM_RE = re.compile(r"(?<![\w-])\d[\d,]*(?:\.\d+)?(?![\d-])")


def number_warnings(text: str, source: str) -> list[str]:
    """본문 숫자 중 제품 자료·가이드라인에 없는 것 (10 미만·연락처·암호화 규격 제외)."""
    src = re.sub(r"[\s,]", "", source)
    clean = re.sub(r"1877-3836|AES-?256|SHA-?256|\[사진\d+\]|^\s*\d+\.", " ", text, flags=re.M)
    out = []
    for m in NUM_RE.finditer(clean):
        num = m.group().replace(",", "").rstrip(".")
        if not num or float(num) < 10 or num in src:
            continue
        ctx = clean[max(0, m.start() - 12): m.end() + 8].replace("\n", " ")
        out.append(f"{m.group()} — …{ctx}…")
    return out


def condition_check(text: str) -> list[dict]:
    """가이드라인과 매뉴얼 조건이 부딪히는 문장: trigger가 나온 문단에 require가 없으면 실패."""
    out = []
    for c in CONDITIONS:
        bad = [p.strip() for p in text.split("\n")
               if re.search(c["trigger"], p) and not any(r in p for r in c["require"])]
        out.append({"id": c["id"], "항목": c["항목"], "통과": not bad, "근거": c["근거"],
                    "사유": "조건 명시됨 또는 해당 문장 없음" if not bad else f"조건 없이 쓴 문단 {len(bad)}개: " + " / ".join(b[:60] for b in bad)})
    return out


def full_check(title: str, body: str, source: str, model: str | None = None) -> dict:
    items = code_check(title, body) + ai_check(title, body, model)
    order = {f"K{i}": i for i in range(1, 4)} | {f"M{i}": 3 + i for i in range(1, 12)} | {f"F{i}": 14 + i for i in range(1, 4)}
    items.sort(key=lambda r: order.get(r["id"], 99))
    # 지어내지 않으려고 비워 둔 칸 때문에 실패한 항목은 '사람 입력 필요'로 따로 센다 (자동 수정 대상 아님)
    for r in items:
        hole = {"M8": "[직접 입력", "M9": "[이미지 필요"}.get(r["id"])
        if not r["통과"] and hole and hole in body:
            r["사람"] = True
            r["사유"] += f" → 담당자가 '{hole}…]' 칸을 채우면 충족"
    passed = sum(r["통과"] for r in items)
    human = sum(bool(r.get("사람")) for r in items)
    return {"items": items, "passed": passed, "human": human, "total": len(items),
            "conditions": condition_check(f"{title}\n{body}"),
            "numbers": number_warnings(body, source) if source else [], "ad_notice": AD_NOTICE in body}


# ---------------------------------------------------------------- 자동 수정
def revise(title: str, body: str, report: dict, model: str | None = None) -> dict:
    failed = [f"- {r['id']} {r['항목']}: {r['사유']}" for r in report["items"] if not r["통과"] and not r.get("사람")]
    failed += [f"- {c['id']} {c['항목']} ({c['근거']}): {c['사유']}" for c in report.get("conditions", []) if not c["통과"]]
    if report["numbers"]:
        failed.append("- 근거 없는 숫자(삭제하거나 자료에 있는 표현으로 바꿀 것): " + "; ".join(report["numbers"]))
    if not report["ad_notice"]:
        failed.append(f"- 본문 맨 끝에 '{AD_NOTICE}' 추가")
    user = (
        "아래 블로그 글에서 검수에 실패한 항목만 고쳐라. 통과한 부분, 소제목, '[사진N]'·'[이미지 필요: …]'·'[직접 입력: …]' 표시는 유지한다. "
        "자료에 없는 수치를 새로 넣지 않는다.\n"
        f"[실패 항목]\n" + "\n".join(failed)
        + f"\n[하단 필수 문구]\n{FOOTER_TEXT}\n{AD_NOTICE}\n\n[제목]\n{title}\n[본문]\n{body}\n\n"
        '형식: {"title": "...", "body": "..."}'
    )
    return ask_json("너는 브랜드 가이드라인에 맞춰 글을 고치는 에디터다. JSON으로만 답한다.", user, model)


def check_cards(cards: list[dict]) -> list[str]:
    probs = []
    for i, c in enumerate(cards, 1):
        if len(c.get("제목", "")) > 16:
            probs.append(f"{i}장 제목 {len(c['제목'])}자 (16자 초과)")
        if len(c.get("문구", "")) > 50:
            probs.append(f"{i}장 문구 {len(c['문구'])}자 (50자 초과)")
    if len(cards) != 5:
        probs.append(f"카드 {len(cards)}장 (5장 아님)")
    return probs
