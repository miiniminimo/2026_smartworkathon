"""근거편집장 웹 화면: streamlit run app.py"""
import json
import os
import re
import time
from pathlib import Path

import streamlit as st

from core import (DEFAULT_MODEL, analyze_differentiators, check_cards, corpus_text, extract_pages, full_check,
                  generate_content, revise)

st.set_page_config(page_title="근거편집장", page_icon="📎", layout="wide")
ss = st.session_state

st.title("근거편집장")
st.caption("출처를 짚고 쓰는 B2B 홍보 원고 AI · 첫 적용 사례: 티링크 비즈레코딩 (2026년 11월 리뷰 가이드라인)")

with st.sidebar:
    model = st.text_input("OpenAI 모델", DEFAULT_MODEL)
    if not os.environ.get("OPENAI_API_KEY"):
        key = st.text_input("OpenAI API 키", type="password", help="저장하지 않고 이 실행에서만 씁니다.")
        if key:
            os.environ["OPENAI_API_KEY"] = key
    st.markdown("**순서**\n1. 제품 자료 → 근거 있는 차별점\n2. 현장 사진 → 블로그·카드뉴스 원고\n3. 가이드라인·적용 조건 검수 → 자동 수정")
    st.caption("게시는 하지 않습니다. 최종 게시는 담당자가 확인 후 직접 합니다.")


def load_pages(files, folder):
    pages = []
    for f in files or []:
        pages += extract_pages(f.name, f.getvalue())
    if folder and Path(folder).is_dir():
        for p in sorted(Path(folder).iterdir()):
            if p.suffix.lower() == ".pdf" and p.stat().st_size > 50 * 2**20:
                continue  # 이미지 위주 대용량 PDF는 건너뜀
            pages += extract_pages(p.name, p.read_bytes())
    return pages


# ---------------------------------------------------------------- ①
st.header("① 제품 자료에서 근거 있는 차별점 뽑기")
c1, c2 = st.columns([2, 1])
files = c1.file_uploader("제안서·매뉴얼·가이드라인 (PPTX·PDF·XLSX)", type=["pptx", "pdf", "xlsx", "txt", "md"], accept_multiple_files=True)
folder = c2.text_input("또는 자료 폴더 경로 (로컬 실행 시)")
if st.button("차별점 분석", type="primary"):
    pages = load_pages(files, folder)
    if not pages:
        st.warning("자료를 올려 주세요.")
        st.stop()
    with st.spinner(f"자료 {len({p['doc'] for p in pages})}개 · {len(pages)}쪽 분석 중…"):
        t = time.time()
        ss.items, ss.pages, ss.t1 = analyze_differentiators(pages, model), pages, time.time() - t
    for k in ("content", "report", "history"):
        ss.pop(k, None)

if "items" in ss:
    ok = sum(i["근거확인"] for i in ss.items)
    st.success(f"차별점 {len(ss.items)}개 중 원문 인용 확인 {ok}개 · {ss.t1:.0f}초 — 확인 안 된 항목은 원고에 쓰지 않습니다.")
    rows = []
    for it in ss.items:
        ev = (it.get("근거") or [{}])[0]
        rows.append({"인용 확인": "✅" if it["근거확인"] else "❌ 제외", "차별점": it.get("차별점"), "고객 혜택": it.get("고객혜택"),
                     "근거": f"{ev.get('문서', '')} {ev.get('쪽', '')}쪽" + (" (쪽 바로잡음)" if ev.get("쪽수정") else ""),
                     "원문 인용": ev.get("인용", "")})
    st.dataframe(rows, hide_index=True)

# ---------------------------------------------------------------- ②
st.header("② 현장 사진으로 원고 쓰기")
photos = st.file_uploader("현장 사진 1~5장 (올린 순서 = 사진1~5)", type=["jpg", "jpeg", "png"], accept_multiple_files=True)
customer = st.text_area("대상 고객사 정보 (선택) — 넣으면 그 업종에 맞춘 버전과 미팅에서 확인할 질문을 만듭니다",
                        placeholder="예: 직원 40명 보험대리점. 설계사 25명이 외근 중 휴대폰으로 상담하고, 사무실은 KT 인터넷전화를 씀", height=80)
if st.button("원고 생성", type="primary", disabled="items" not in ss):
    imgs = [p.getvalue() for p in (photos or [])][:5]
    if not imgs:
        st.warning("사진을 1장 이상 올려 주세요.")
        st.stop()
    with st.spinner("사진 장면 읽고 원고 쓰는 중…"):
        t = time.time()
        ss.content = generate_content(imgs, ss.items, model, customer=customer, pages=ss.pages)
    ss.imgs, ss.t2 = imgs, time.time() - t
    ss.title, ss.body = ss.content.get("title", ""), ss.content.get("body", "")
    ss.history = []
    ss.pop("report", None)


def render_blog(title, body, imgs):
    st.subheader(title)
    buf = []
    for line in body.split("\n"):
        m = re.fullmatch(r"\s*\[사진(\d+)\]\s*", line)
        if m or line.strip().startswith("[이미지 필요"):
            st.markdown("\n".join(buf))
            buf = []
            if m and 0 < int(m.group(1)) <= len(imgs):
                st.image(imgs[int(m.group(1)) - 1], width=480, caption=f"사진{m.group(1)}")
            else:
                st.info(line.strip())
        else:
            buf.append(line.replace("[직접 입력", "🟨[직접 입력"))
    st.markdown("\n".join(buf))


if "content" in ss:
    c = ss.content
    st.success(f"원고 생성 {ss.t2:.0f}초 · 본문 {len(ss.body):,}자")
    cols = st.columns(len(ss.imgs))
    for i, (col, img) in enumerate(zip(cols, ss.imgs), 1):
        col.image(img)
        d = next((d for d in c.get("사진설명", []) if d.get("사진") == i), {})
        col.caption(f"**사진{i}** {d.get('장면', '')}\n→ {d.get('연결차별점', '')}")
    tab1, tab2 = st.tabs(["블로그 원고", "카드뉴스 5장"])
    with tab1:
        render_blog(ss.title, ss.body, ss.imgs)
    with tab2:
        cards = c.get("cards", [])
        for col, card in zip(st.columns(max(len(cards), 1)), cards):
            col.markdown(f"#### {card.get('제목', '')}\n{card.get('문구', '')}")
        for p in check_cards(cards):
            st.warning(p)
    if c.get("questions") and any(q and "고객사 정보" not in q for q in c["questions"]):
        st.markdown("**미팅에서 확인할 질문** (니즈를 단정하지 않고 확인으로 돌림)\n" + "\n".join(f"- {q}" for q in c["questions"]))

# ---------------------------------------------------------------- ③
st.header("③ 가이드라인·적용 조건 검수")


def run_check():
    rep = full_check(ss.title, ss.body, corpus_text(ss.get("pages", []), limit=10**9), model)
    ss.report = rep
    ss.history.append({"passed": rep["passed"], "total": rep["total"],
                       "cond": sum(not x["통과"] for x in rep["conditions"]), "nums": len(rep["numbers"])})


with st.expander("다른 원고 검수 — 대행사·체험단·일반 AI가 쓴 원고 붙여넣기"):
    p_title = st.text_input("제목")
    p_body = st.text_area("본문", height=200)
    if st.button("붙여넣은 원고 검수", disabled=not p_body.strip()):
        ss.title, ss.body, ss.history = p_title, p_body, []
        ss.setdefault("imgs", [])
        ss.setdefault("content", {"cards": []})
        with st.spinner("17개 항목 검사 중…"):
            run_check()

b1, b2 = st.columns(2)
if b1.button("검수", type="primary", disabled="content" not in ss):
    with st.spinner("17개 항목 검사 중…"):
        run_check()
if b2.button("미통과 부분만 자동 수정", disabled="report" not in ss):
    with st.spinner("미통과 부분 고치는 중…"):
        fixed = revise(ss.title, ss.body, ss.report, model)
        ss.title, ss.body = fixed.get("title", ss.title), fixed.get("body", ss.body)
        run_check()
    st.rerun()

if "report" in ss:
    rep = ss.report
    m = st.columns(4)
    m[0].metric("가이드라인", f"{rep['passed']}/{rep['total']}")
    m[1].metric("적용 조건 위반", sum(not x["통과"] for x in rep["conditions"]))
    m[2].metric("근거 없는 숫자", len(rep["numbers"]))
    m[3].metric("광고 표시", "있음" if rep["ad_notice"] else "없음")
    if len(ss.history) > 1:
        st.info("검수 기록: " + " → ".join(f"{h['passed']}/{h['total']}(조건 위반 {h['cond']}, 숫자 {h['nums']})" for h in ss.history))
    st.dataframe([{"": "✅" if r["통과"] else "❌", "ID": r["id"], "항목": r["항목"], "판정": r["판정"], "사유": r["사유"]}
                  for r in rep["items"]], hide_index=True)
    for x in rep["conditions"]:
        (st.success if x["통과"] else st.error)(f"{x['id']} {x['항목']} — {x['사유']} · 근거: {x['근거']}")
    for n in rep["numbers"]:
        st.warning(f"자료에 없는 숫자: {n}")
    st.download_button("원고 내려받기 (.md)", f"# {ss.title}\n\n{ss.body}\n", file_name="원고.md")
    st.download_button("검수 결과 내려받기 (.json)", json.dumps(rep, ensure_ascii=False, indent=1), file_name="검수결과.json")
