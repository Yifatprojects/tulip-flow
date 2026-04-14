-- מבנה הטבלאות (Schema)
CREATE TABLE movies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    movie_name_en TEXT NOT NULL,
    movie_name_he TEXT,
    studio_code TEXT UNIQUE,
    studio_name TEXT,
    release_date DATE
);

CREATE TABLE expense_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category_name TEXT NOT NULL,
    reporting_code TEXT NOT NULL
);

CREATE TABLE budgets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    movie_id UUID REFERENCES movies(id),
    category_id UUID REFERENCES expense_categories(id),
    budgeted_amount DECIMAL(12, 2),
    UNIQUE(movie_id, category_id)
);

CREATE TABLE actual_expenses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    movie_id UUID REFERENCES movies(id),
    category_id UUID REFERENCES expense_categories(id),
    amount DECIMAL(12, 2),
    expense_date DATE,
    description TEXT
);
