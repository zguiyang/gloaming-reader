--> Data migration: drop seeded category enumeration rows that no work references.
--> Referenced seed rows stay — they became de-facto categories once works link to them.
--> (The 16-class seed was a competitor benchmark; categories now grow from admin/AI.)
DELETE FROM "category"
WHERE "id" LIKE 'cat-%'
  AND NOT EXISTS (SELECT 1 FROM "reading_work_category" rc WHERE rc."category_id" = "category"."id");--> statement-breakpoint
--> Seed: common English content sources (match_rule drives dc:source association in metadata-fill).
--> Sources are create/edit-only — never deletable.
INSERT INTO "source" ("id", "name", "match_rule") VALUES
	('src-gutenberg', 'Project Gutenberg', 'gutenberg.org'),
	('src-standard-ebooks', 'Standard Ebooks', 'standardebooks.org'),
	('src-wikipedia', 'Wikipedia', 'wikipedia.org'),
	('src-internet-archive', 'Internet Archive', 'archive.org'),
	('src-open-library', 'Open Library', 'openlibrary.org'),
	('src-wikisource', 'Wikisource', 'wikisource.org'),
	('src-manybooks', 'ManyBooks', 'manybooks.net'),
	('src-feedbooks', 'Feedbooks', 'feedbooks.com'),
	('src-smashwords', 'Smashwords', 'smashwords.com'),
	('src-google-books', 'Google Books', 'books.google'),
	('src-apple-books', 'Apple Books', 'books.apple'),
	('src-amazon-kindle', 'Amazon Kindle', 'amazon.com'),
	('src-kobo', 'Kobo', 'kobo.com'),
	('src-barnes-noble', 'Barnes & Noble', 'barnesandnoble.com'),
	('src-hathitrust', 'HathiTrust', 'hathitrust.org'),
	('src-librivox', 'LibriVox', 'librivox.org')
ON CONFLICT ("name") DO NOTHING;