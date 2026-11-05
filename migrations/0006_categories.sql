-- 요리 종류(한식·중식·양식·일식·브런치·디저트). JSON 배열, 빈 배열은 '기타'.
-- NULL은 아직 정하지 않았다는 뜻이다(이 기능 전에 저장한 레시피). 관리 화면에서 AI로 한꺼번에 정한다.
ALTER TABLE recipes ADD COLUMN categories TEXT;
