-- 사진이 쓰이는지 확인하는 쿼리(지울 때, 매일 정리할 때)가 표 전체를 훑지 않도록
CREATE INDEX IF NOT EXISTS idx_recipes_image ON recipes(image);
CREATE INDEX IF NOT EXISTS idx_cache_image ON extraction_cache(image);
CREATE INDEX IF NOT EXISTS idx_images_created ON images(created_at);
