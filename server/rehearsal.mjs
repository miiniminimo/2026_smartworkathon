export function rehearsalCase() {
  return {
    photo:'/samples/office-equipment.jpg',
    input:{ installation_type:'', region:'', field_note:'' },
    result:{
      origin:'rehearsal', photo_note:'네트워크 케이블 · 공개 자료 사진 (CC0)',
      brief:{
        headline:'[연동 테스트] 사진 한 장이 블로그 글이 되기까지',
        external_problem:'글을 다 썼어도 발행 화면에 옮기면 확인할 것이 남습니다. 제목이 제자리에 있는지, 사진 아래 설명이 붙었는지, 단락을 나눈 호흡이 그대로인지 살펴봅니다.',
        internal_problem:'이 글에서는 파란 케이블 사진 한 장을 기준으로 편집 전후의 모습을 비교합니다. 글을 읽다가 사진을 만나는 지점과 다음 소제목 사이에 여백이 생기는지도 확인할 수 있습니다.',
        fundamental_problem:'좋은 미리보기의 기준은 마지막으로 읽는 화면에서도 같은 순서로 이야기를 따라갈 수 있는가입니다.',
        success:'이 문단 아래 체크리스트까지 보인다면 제목, 본문, 인용문, 사진과 목록을 한 게시물 안에서 차례대로 대조할 수 있습니다.',
        identity_change:'발행 전에는 직접 공개 범위를 고릅니다. 발행한 뒤에는 게시물 주소를 다시 열어 마지막 줄까지 읽어 봅니다.',
        fact_ids:['studio-test-photo'],tags:['블로그연동테스트','편집기점검','자료사진'],
        editorial:{scene_heading:'사진과 문장이 만나는 자리',practice_heading:'편집기에서 살펴볼 부분',checklist_heading:'발행 전 확인할 세 가지',checklist:['사진이 본문 안에서 열리는지 확인합니다.','소제목과 인용문의 줄바꿈을 읽어 봅니다.','게시 대상과 공개 범위를 마지막으로 확인합니다.']}
      },
      used_facts:[{id:'studio-test-photo',text:'첨부한 케이블 사진은 CC0로 공개된 자료 사진입니다.',source:'Wikimedia Commons · EthernetCableBlue2.jpg · CC0 1.0'}],
      cta_text:'개인 블로그에서 편집기 연결을 점검하기 위해 작성한 테스트 글입니다.',
      sms_ad_text:null,sms_opt_out_text:null
    }
  }
}
