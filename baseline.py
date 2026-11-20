"""비교 기준: 담당자가 일반 GPT에 가이드라인·제안서만 붙여넣고 쓴 초안을 같은 검수기로 채점.
python baseline.py <제품자료 폴더> [편수=3] → samples/baseline/"""
import json
import sys
import unicodedata
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from core import ask_json, corpus_text, extract_pages, full_check


def one(i, guide, proposal, source, out):
    t = time.time()
    draft = ask_json("너는 블로그 원고 작가다. JSON으로만 답한다.",
                     "아래 티링크 리뷰 가이드라인과 제품 제안서를 참고해서 네이버 블로그 리뷰 글을 써줘. "
                     '형식: {"title": "...", "body": "..."}\n\n[가이드라인]\n' + guide + "\n\n[제안서]\n" + proposal)
    gen = time.time() - t
    rep = full_check(draft["title"], draft["body"], source)
    (out / f"draft_{i}.md").write_text(f"# {draft['title']}\n\n{draft['body']}\n")
    (out / f"report_{i}.json").write_text(json.dumps(rep, ensure_ascii=False, indent=1))
    return {"i": i, "gen_s": round(gen, 1), "passed": rep["passed"], "total": rep["total"],
            "cond_fail": sum(not c["통과"] for c in rep["conditions"]), "numbers": len(rep["numbers"]),
            "ad_notice": rep["ad_notice"], "failed": [r["id"] for r in rep["items"] if not r["통과"]],
            "cond_detail": [c["사유"] for c in rep["conditions"] if not c["통과"]], "number_detail": rep["numbers"]}


def main(src_dir, n=3):
    out = Path("samples/baseline")
    out.mkdir(parents=True, exist_ok=True)
    files = {unicodedata.normalize("NFC", f.name): f for f in Path(src_dir).iterdir()}
    guide = corpus_text(extract_pages(*next((k, v.read_bytes()) for k, v in files.items() if k.endswith(".xlsx"))))
    proposal = corpus_text(extract_pages(*next((k, v.read_bytes()) for k, v in files.items() if "제안서" in k)))
    pages = []
    for f in files.values():
        if not (f.suffix.lower() == ".pdf" and f.stat().st_size > 50 * 2**20):
            pages += extract_pages(f.name, f.read_bytes())
    source = corpus_text(pages, limit=10**9)
    with ThreadPoolExecutor(int(n)) as ex:
        res = list(ex.map(lambda i: one(i, guide, proposal, source, out), range(1, int(n) + 1)))
    (out / "summary.json").write_text(json.dumps(res, ensure_ascii=False, indent=1))
    for r in res:
        print(r)


if __name__ == "__main__":
    main(*sys.argv[1:])
