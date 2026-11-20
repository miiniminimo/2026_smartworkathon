"""화면 없이 전체 흐름 실행: python demo.py <제품자료 폴더> <사진 폴더>  → samples/out/에 결과 저장"""
import json
import sys
import time
from pathlib import Path

from core import (analyze_differentiators, check_cards, corpus_text, extract_pages, full_check, generate_content,
                  revise)

MAX_PDF_MB = 50  # 회사소개서(237MB)처럼 이미지 위주 대용량 PDF는 건너뜀


def main(src_dir: str, photo_dir: str, out_dir: str = "samples/out"):
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    pages = []
    for f in sorted(Path(src_dir).iterdir()):
        if f.suffix.lower() == ".pdf" and f.stat().st_size > MAX_PDF_MB * 2**20:
            print("건너뜀(용량):", f.name)
            continue
        pages += extract_pages(f.name, f.read_bytes())
    print(f"자료 {len({p['doc'] for p in pages})}개, {len(pages)}쪽 추출 ({time.time() - t0:.1f}s)")

    t = time.time()
    items = analyze_differentiators(pages)
    ok = sum(i["근거확인"] for i in items)
    print(f"차별점 {len(items)}개 중 인용 확인 {ok}개 ({time.time() - t:.1f}s)")

    photos = [p.read_bytes() for p in sorted(Path(photo_dir).iterdir()) if p.suffix.lower() in (".jpg", ".jpeg", ".png")]
    t = time.time()
    content = generate_content(photos, items)
    print(f"콘텐츠 생성 ({time.time() - t:.1f}s), 본문 {len(content.get('body', ''))}자")

    source = corpus_text(pages, limit=10**9)
    history = []
    title, body = content.get("title", ""), content.get("body", "")
    for round_ in range(3):
        rep = full_check(title, body, source)
        cond_fail = sum(not c["통과"] for c in rep["conditions"])
        history.append({"round": round_, "passed": rep["passed"], "human": rep["human"], "total": rep["total"],
                        "condition_fail": cond_fail, "number_warn": len(rep["numbers"]), "ad_notice": rep["ad_notice"],
                        "failed": [r["id"] for r in rep["items"] if not r["통과"]]})
        print(f"검수 {round_}회차: {rep['passed']}/{rep['total']} 통과(사람 입력 필요 {rep['human']}), 조건 위반 {cond_fail}, 근거 없는 숫자 {len(rep['numbers'])}")
        if rep["passed"] + rep["human"] == rep["total"] and not cond_fail and not rep["numbers"] and rep["ad_notice"]:
            break
        if round_ < 2:
            fixed = revise(title, body, rep)
            title, body = fixed.get("title", title), fixed.get("body", body)

    (out / "1_차별점.json").write_text(json.dumps(items, ensure_ascii=False, indent=1))
    (out / "2_콘텐츠_초안.json").write_text(json.dumps(content, ensure_ascii=False, indent=1))
    (out / "3_블로그_최종.md").write_text(f"# {title}\n\n{body}\n")
    (out / "4_카드뉴스.json").write_text(json.dumps({"cards": content.get("cards", []), "문제": check_cards(content.get("cards", []))}, ensure_ascii=False, indent=1))
    (out / "5_검수결과.json").write_text(json.dumps({"history": history, "last": rep}, ensure_ascii=False, indent=1))
    print(f"전체 {time.time() - t0:.1f}s, 결과: {out}/")


if __name__ == "__main__":
    main(*sys.argv[1:])
