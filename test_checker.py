"""검수기 자체 시험 (API 없이 실행): python test_checker.py"""
from core import code_check, condition_check, number_warnings, verify_quotes

GOOD_TITLE = "티링크 비즈레코딩 후기: 통화요약·콜센터 프로그램·업무자동화로 끝낸 영업사원 통화관리"
GOOD_BODY = """티링크 비즈레코딩으로 영업사원 통화관리를 바꿨습니다. 휴대폰 통화녹음과 인터넷전화 자동녹취가 함께 됩니다.
외근 휴대폰, 사무실 인터넷전화, 집에서는 PC폰(삼성 070 계정 사용 시 녹음)까지 하나의 관리 화면에서 봅니다. KT, SK, LG 모두 됩니다.
통화가 끝나면 STT 문자변환과 AI 통화요약, 핵심 키워드, 고객 요청사항, 후속 조치가 기록됩니다. 콜센터 프로그램을 따로 쓸 필요가 없고 업무자동화가 됩니다.
직원별 통화량, 평균 통화시간, 상담 이력, 미결 상담, 후속 연락 여부를 봅니다.
조직별·직원별 현황과 고객 이탈 위험을 종합 리포트와 경영 대시보드에서 확인합니다. 녹취는 AES256, SHA256으로 암호화하고 접근권한을 나눕니다.
결론적으로 영업 활동을 자동으로 기록하고 경영에 필요한 정보로 정리해 주는 기업용 영업관리 솔루션입니다.
홈페이지(www.tlinkcrm.com) / 블로그(https://blog.naver.com/mobilecrm)
상담 문의 : 1877-3836"""


def test_code_check_all_pass():
    res = {r["id"]: r for r in code_check(GOOD_TITLE, GOOD_BODY)}
    assert all(r["통과"] for r in res.values()), [r for r in res.values() if not r["통과"]]
    assert len(res) == 13  # 코드 판정 13개 + AI 판정 4개 = 17


def test_code_check_catches_missing():
    res = {r["id"]: r for r in code_check("티링크 후기", GOOD_BODY.replace("1877-3836", ""))}
    assert not res["K1"]["통과"] and "제목" in res["K1"]["사유"]
    assert not res["M1"]["통과"]
    assert not res["F3"]["통과"]


def test_pc_phone_condition():
    assert condition_check(GOOD_BODY)[0]["통과"]
    assert not condition_check("PC폰으로도 모든 통화를 자동 녹음합니다.")[0]["통과"]
    assert condition_check("휴대폰 통화를 녹음합니다.")[0]["통과"]  # PC폰 언급 없으면 해당 없음


def test_number_grounding():
    src = "1,000+ 도입 기업 99% 녹취 성공률"
    warn = number_warnings("도입 기업 1,000곳, 녹취 성공률 99%, 업무 시간 73% 감소", src)
    assert len(warn) == 1 and warn[0].startswith("73")


def test_verify_quotes_fixes_page():
    pages = [{"doc": "제안서", "page": 3, "text": "99% 녹취 성공률\nAES256 녹취파일 암호화"}]
    items = [{"차별점": "보안", "근거": [{"문서": "제안서", "쪽": 9, "인용": "AES256 녹취파일 암호화"}]},
             {"차별점": "가짜", "근거": [{"문서": "제안서", "쪽": 3, "인용": "세계 1위 녹취"}]}]
    out = verify_quotes(items, pages)
    assert out[0]["근거확인"] and out[0]["근거"][0]["쪽"] == 3
    assert not out[1]["근거확인"]


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("통과", name)
