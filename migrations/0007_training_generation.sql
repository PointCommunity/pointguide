ALTER TABLE training_sessions ADD COLUMN IF NOT EXISTS answer_error TEXT;
UPDATE training_sessions SET answer_error='The revision did not complete. Your feedback is saved. Retry this revision.' WHERE state='REVISING' AND answer_error IS NULL;
