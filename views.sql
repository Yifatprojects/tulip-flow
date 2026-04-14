-- Reporting views: use movie_name_en / movie_name_he (not movie_name).
-- Run in Supabase SQL Editor after migrating the movies table.
-- Adjust JOINs to match your real view definitions if they differ.

-- Example: detailed budget lines per movie and category
CREATE OR REPLACE VIEW view_budgets_detailed AS
SELECT
  m.id AS movie_id,
  m.studio_code,
  m.studio_name,
  m.movie_name_en,
  m.movie_name_he,
  m.release_date,
  ec.id AS category_id,
  ec.category_name,
  ec.reporting_code,
  b.budgeted_amount,
  COALESCE(a.actual_total, 0::numeric) AS actual_spent,
  COALESCE(b.budgeted_amount, 0::numeric) - COALESCE(a.actual_total, 0::numeric) AS variance
FROM movies m
JOIN budgets b ON b.movie_id = m.id
JOIN expense_categories ec ON ec.id = b.category_id
LEFT JOIN (
  SELECT movie_id, category_id, SUM(amount) AS actual_total
  FROM actual_expenses
  GROUP BY movie_id, category_id
) a ON a.movie_id = m.id AND a.category_id = ec.id;

-- Helper: single display title (English preferred)
CREATE OR REPLACE VIEW view_movies_display AS
SELECT
  id,
  studio_code,
  studio_name,
  movie_name_en,
  movie_name_he,
  COALESCE(NULLIF(TRIM(movie_name_en), ''), NULLIF(TRIM(movie_name_he), '')) AS display_title,
  release_date
FROM movies;
