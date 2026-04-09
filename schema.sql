CREATE TABLE IF NOT EXISTS builds (
                                      id TEXT PRIMARY KEY,
                                      nom TEXT NOT NULL,
                                      description TEXT,
                                      auteur TEXT,
                                      auteurId TEXT NOT NULL,
                                      encoded TEXT NOT NULL,
                                      likes INTEGER DEFAULT 0,
                                      timestamp INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tags (
                                    build_id TEXT,
                                    tag TEXT,
                                    PRIMARY KEY (build_id, tag),
    FOREIGN KEY (build_id) REFERENCES builds(id) ON DELETE CASCADE
    );

CREATE TABLE IF NOT EXISTS build_likes (
                                           build_id TEXT,
                                           user_id TEXT,
                                           PRIMARY KEY (build_id, user_id),
    FOREIGN KEY (build_id) REFERENCES builds(id) ON DELETE CASCADE
    );