CREATE TABLE IF NOT EXISTS builds (
                                      id TEXT PRIMARY KEY,
                                      nom TEXT NOT NULL,
                                      nom_normalized TEXT NOT NULL,
                                      description TEXT,
                                      description_normalized TEXT,
                                      auteur TEXT,
                                      auteur_normalized TEXT,
                                      auteurId TEXT NOT NULL,
                                      encoded TEXT NOT NULL,
                                      likes INTEGER DEFAULT 0,
                                      timestamp INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tags (
                                    build_id TEXT,
                                    tag TEXT,
                                    tag_normalized TEXT NOT NULL,
                                    PRIMARY KEY (build_id, tag),
    FOREIGN KEY (build_id) REFERENCES builds(id) ON DELETE CASCADE
    );

CREATE TABLE IF NOT EXISTS build_likes (
                                           build_id TEXT,
                                           user_id TEXT,
                                           timestamp INTEGER NOT NULL,
                                           PRIMARY KEY (build_id, user_id),
    FOREIGN KEY (build_id) REFERENCES builds(id) ON DELETE CASCADE
    );