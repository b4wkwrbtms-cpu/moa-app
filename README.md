# moa. 모아상점 웹앱

가맹점 전용 주문몰 화면 파일만 들어 있는 저장소입니다. 휴대폰에서 확인하기 위해 GitHub Pages로 공개합니다.

- 소스와 DB 설계는 비공개 저장소 `moa-store`에 있고, 여기에는 빌드 결과물(`index.html`, 아이콘, manifest)만 올립니다.
- 데이터는 Supabase에 있으며 로그인한 사람의 권한(RLS) 안에서만 읽고 쓸 수 있습니다. 화면에 들어 있는 키는 공개용 키입니다.
- 이 저장소의 파일은 직접 고치지 말고, `moa-store`에서 `python3 prototype/build.py`로 다시 만들어 덮어씁니다.
