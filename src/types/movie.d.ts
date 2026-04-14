/**
 * Row shape for `public.movies` (Supabase).
 * Business identifier: `movie_code`.
 */
export interface Movie {
  id: string
  movie_name_en: string
  movie_name_he: string | null
  movie_code: string | null
  studio_name: string | null
  release_date: string | null
}
