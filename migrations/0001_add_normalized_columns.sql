-- Migration: Add normalized columns for search optimization
-- Description: Adds nom_normalized, description_normalized, auteur_normalized to builds table,
-- and tag_normalized to tags table. Populates them for existing data.

-- 1. Add columns to builds table
-- nom_normalized is NOT NULL in schema.sql, so we add it with a default for existing rows.
ALTER TABLE builds ADD COLUMN nom_normalized TEXT NOT NULL DEFAULT '';
ALTER TABLE builds ADD COLUMN description_normalized TEXT;
ALTER TABLE builds ADD COLUMN auteur_normalized TEXT;

-- 2. Add column to tags table
ALTER TABLE tags ADD COLUMN tag_normalized TEXT NOT NULL DEFAULT '';

-- 3. Update existing data
-- We use nested REPLACE to simulate the normalization (lowercase and no accents).
-- There are 32 replacements in total.

UPDATE builds
SET
    nom_normalized = LOWER(
        REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
            nom,
            'é', 'e'), 'è', 'e'), 'ê', 'e'), 'ë', 'e'),
            'à', 'a'), 'â', 'a'), 'ä', 'a'),
            'î', 'i'), 'ï', 'i'),
            'ô', 'o'), 'ö', 'o'),
            'û', 'u'), 'ù', 'u'), 'ü', 'u'),
            'ç', 'c'), 'ñ', 'n'),
            'É', 'e'), 'È', 'e'), 'Ê', 'e'), 'Ë', 'e'),
            'À', 'a'), 'Â', 'a'), 'Ä', 'a'),
            'Î', 'i'), 'Ï', 'i'),
            'Ô', 'o'), 'Ö', 'o'),
            'Û', 'u'), 'Ù', 'u'), 'Ü', 'u'),
            'Ç', 'c'), 'Ñ', 'n')
    ),
    description_normalized = CASE
        WHEN description IS NOT NULL THEN LOWER(
            REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                description,
                'é', 'e'), 'è', 'e'), 'ê', 'e'), 'ë', 'e'),
                'à', 'a'), 'â', 'a'), 'ä', 'a'),
                'î', 'i'), 'ï', 'i'),
                'ô', 'o'), 'ö', 'o'),
                'û', 'u'), 'ù', 'u'), 'ü', 'u'),
                'ç', 'c'), 'ñ', 'n'),
                'É', 'e'), 'È', 'e'), 'Ê', 'e'), 'Ë', 'e'),
                'À', 'a'), 'Â', 'a'), 'Ä', 'a'),
                'Î', 'i'), 'Ï', 'i'),
                'Ô', 'o'), 'Ö', 'o'),
                'Û', 'u'), 'Ù', 'u'), 'Ü', 'u'),
                'Ç', 'c'), 'Ñ', 'n')
        )
        ELSE NULL
    END,
    auteur_normalized = LOWER(
        REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
            auteur,
            'é', 'e'), 'è', 'e'), 'ê', 'e'), 'ë', 'e'),
            'à', 'a'), 'â', 'a'), 'ä', 'a'),
            'î', 'i'), 'ï', 'i'),
            'ô', 'o'), 'ö', 'o'),
            'û', 'u'), 'ù', 'u'), 'ü', 'u'),
            'ç', 'c'), 'ñ', 'n'),
            'É', 'e'), 'È', 'e'), 'Ê', 'e'), 'Ë', 'e'),
            'À', 'a'), 'Â', 'a'), 'Ä', 'a'),
            'Î', 'i'), 'Ï', 'i'),
            'Ô', 'o'), 'Ö', 'o'),
            'Û', 'u'), 'Ù', 'u'), 'Ü', 'u'),
            'Ç', 'c'), 'Ñ', 'n')
    );

UPDATE tags
SET
    tag_normalized = LOWER(
        REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
            tag,
            'é', 'e'), 'è', 'e'), 'ê', 'e'), 'ë', 'e'),
            'à', 'a'), 'â', 'a'), 'ä', 'a'),
            'î', 'i'), 'ï', 'i'),
            'ô', 'o'), 'ö', 'o'),
            'û', 'u'), 'ù', 'u'), 'ü', 'u'),
            'ç', 'c'), 'ñ', 'n'),
            'É', 'e'), 'È', 'e'), 'Ê', 'e'), 'Ë', 'e'),
            'À', 'a'), 'Â', 'a'), 'Ä', 'a'),
            'Î', 'i'), 'Ï', 'i'),
            'Ô', 'o'), 'Ö', 'o'),
            'Û', 'u'), 'Ù', 'u'), 'Ü', 'u'),
            'Ç', 'c'), 'Ñ', 'n')
    );
