---
version: "alpha"
name: 티링크 콘텐츠 스튜디오
description: 현장 자료를 편집해 네이버 블로그에 전달하는 한국어 원고 발행 스튜디오
colors:
  primary: "#1B1930"
  accent: "#00CEE6"
  neutral: "#F5F5EF"
  editorial: "#153B33"
  editorial-ink: "#F8F5E9"
  editorial-accent: "#CDEAC8"
  surface: "#FFFFFF"
  muted: "#535D55"
  border: "#DADFD5"
  focus: "#007782"
  warning: "#854B0A"
  warning-surface: "#FFF2D9"
  error: "#A6303D"
  error-surface: "#FFF1F2"
  approved: "#16624F"
  approved-surface: "#E1F5EB"
typography:
  headline:
    fontFamily: Inter
    fontSize: 44px
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: -0.035em
  reading:
    fontFamily: Nanum Myeongjo
    fontSize: 18px
    fontWeight: 400
    lineHeight: 1.85
  section:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: 700
    lineHeight: 1.4
    letterSpacing: -0.025em
  body:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: 600
    lineHeight: 1.5
  caption:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: 500
    lineHeight: 1.5
rounded:
  control: 6px
  panel: 9px
  badge: 999px
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  input-column: 324px
  control-height: 44px
components:
  workspace:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.primary}"
  helper-text:
    textColor: "{colors.muted}"
    typography: "{typography.caption}"
  divider:
    backgroundColor: "{colors.border}"
    height: 1px
  focus-indicator:
    backgroundColor: "{colors.focus}"
    size: 2px
  header:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
  sample-spread:
    backgroundColor: "{colors.editorial}"
    textColor: "{colors.editorial-ink}"
  sample-action:
    backgroundColor: "{colors.editorial-accent}"
    textColor: "{colors.editorial}"
  brand-mark:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.primary}"
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    height: "{spacing.control-height}"
  panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.primary}"
    padding: "{spacing.lg}"
    rounded: "{rounded.panel}"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.primary}"
    rounded: "{rounded.control}"
    height: "{spacing.control-height}"
  demo-status:
    backgroundColor: "{colors.warning-surface}"
    textColor: "{colors.warning}"
  approved-status:
    backgroundColor: "{colors.approved-surface}"
    textColor: "{colors.approved}"
  error-message:
    backgroundColor: "{colors.error-surface}"
    textColor: "{colors.error}"
---

## Overview

티링크의 편집자는 현장 브리프를 작성하고, 블로그 원고를 읽고 고친 뒤 연결된 계정으로 보낸다. 밝은 작업 화면 안에 실제 본문 폭의 지면을 두고, 폼과 원고 사이의 차이를 한눈에 보여 준다. 첫 화면의 표지는 준비된 가상 원고를 여는 진입점이다.

## Colors

티링크의 네이비와 시안은 워드마크와 생성 동작에 사용한다. 작업 바탕은 따뜻한 회백색, 입력과 원고의 작업면은 흰색이다. 짙은 초록, 종이색, 연한 민트색을 예시 표지와 원고 제목에 사용한다. 예시·오류·승인·발행 상태에는 색상과 함께 상태명을 표시한다.

## Typography

화면의 제목과 입력 제어에는 Inter 및 기기의 한글 산세리프 대체 글꼴을 사용한다. 표지와 블로그 제목에는 Nanum Myeongjo, AppleMyungjo, Batang 순으로 기기에서 사용할 수 있는 명조 글꼴을 쓴다. 본문은 16px 안팎의 크기와 넉넉한 줄 간격으로 읽도록 하고, 긴 URL은 영역 안에서 개행한다.

## Layout

데스크톱은 약 324px의 브리프와 남은 폭의 작업대로 구성한다. 작업대에는 네이버 블로그·갤러리 카드·문자 탭, 미리보기, 근거 확인, 계정 전송을 차례로 배치한다. 모바일에서는 세로로 쌓고 예시 열기와 생성 후 원고 위치로 이동할 수 있게 한다. 블로그 지면의 본문 폭은 최대 680px로 유지한다.

## Elevation & Depth

얇은 경계선과 바탕색의 차이로 편집면을 분리한다. 연결 설정과 전송 확인 대화상자에만 뚜렷한 그림자와 배경 차폐를 적용한다.

## Shapes

컨트롤은 6px, 패널은 9px로 모서리를 다듬는다. 둥근 상태 표시는 짧게 유지한다. 표지에는 예시용 실제 사진과 용도 설명을 함께 배치한다.

## Motion & Micro-interaction

키보드 포커스를 명확히 표시하고, 생성 중에는 상태 문구를 제공한다. 탭 이동과 미리보기 형식 전환은 현재 작업을 유지한다. 사람의 모션 감소 설정을 우선 적용한다.

## Voice & Content Strategy

원고를 보는 행동, 승인하는 행동, 네이버로 보내는 행동을 각각 구체적인 이름으로 표시한다. 일반 예시는 가상 사례와 자료 사진임을 명시한다. 연결 상태와 실제 발행 결과는 확인된 응답을 바탕으로 안내한다.

## Components

- **현장 브리프.** 사진과 개인정보 입력 안내, 설치 형태·지역·메모를 한 흐름으로 묶는다. 예시 선택과 원래 입력으로 복귀하는 동작을 제공한다.
- **예시 원고 표지.** 준비된 학교 상담 원고의 주제와 자료 사진을 한 지면에 배치하고 해당 예시를 바로 연다.
- **원고 작업대.** 네이버 블로그를 첫 채널로 열고, 서식 미리보기·블록 편집·Markdown 원문을 제공한다. 제목, 소제목, 사진, 인용문, 목록, 상담 안내의 시각 차이를 유지한다.
- **검토 및 발행.** 근거와 사진을 검토한 뒤 명시적으로 승인한다. 네이버 전송 전에는 대상 블로그와 현재 원고 제목을 함께 표시한다.
- **연결 설정.** AI 키·생성 모델·블로그·검증된 제품 문구를 입력하고, 네이버 로그인과 서버 상태를 확인하는 동작을 제공한다.

## Do's and Don'ts

- 예시 자료와 실제 설치 사진의 관계를 명확히 밝힌다.
- 원고 내용이나 입력을 수정하면 이전 승인을 해제한다.
- 실제 공개가 확인된 게시물에만 발행 완료 상태와 링크를 제공한다.
