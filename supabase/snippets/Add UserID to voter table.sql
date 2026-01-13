-- Update last_vote_at to current time for testing premium status
UPDATE users 
SET last_vote_at = NOW() 
WHERE id = '160853902726660096';

-- If the user doesn't exist yet, insert them:
INSERT INTO users (id, last_vote_at)
VALUES ('160853902726660096', NOW())
ON CONFLICT (id) DO UPDATE SET last_vote_at = NOW();