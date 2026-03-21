package sqlite

import (
	"database/sql"
	"fmt"
	"log/slog"
	"sort"
	"strings"
)

type NamedMigration struct {
	Version int
	Name    string
	SQL     string
}

func RunMigrations(db *sql.DB, migrationSQL []NamedMigration) error {
	_, err := db.Exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
		version INTEGER PRIMARY KEY,
		applied_at TEXT NOT NULL DEFAULT (datetime('now'))
	)`)
	if err != nil {
		return fmt.Errorf("create schema_migrations table: %w", err)
	}

	applied := make(map[int]bool)
	rows, err := db.Query("SELECT version FROM schema_migrations")
	if err != nil {
		return fmt.Errorf("query schema_migrations: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var v int
		if err := rows.Scan(&v); err != nil {
			return fmt.Errorf("scan migration version: %w", err)
		}
		applied[v] = true
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate schema_migrations: %w", err)
	}

	sort.Slice(migrationSQL, func(i, j int) bool {
		return migrationSQL[i].Version < migrationSQL[j].Version
	})

	for _, m := range migrationSQL {
		if applied[m.Version] {
			continue
		}

		slog.Info("applying migration", "version", m.Version, "name", m.Name)

		tx, err := db.Begin()
		if err != nil {
			return fmt.Errorf("begin tx for migration %d: %w", m.Version, err)
		}

		stmts := splitStatements(m.SQL)
		for _, stmt := range stmts {
			stmt = strings.TrimSpace(stmt)
			if stmt == "" {
				continue
			}
			if _, err := tx.Exec(stmt); err != nil {
				tx.Rollback()
				return fmt.Errorf("exec migration %d statement: %w\nSQL: %s", m.Version, err, stmt)
			}
		}

		if _, err := tx.Exec("INSERT INTO schema_migrations (version) VALUES (?)", m.Version); err != nil {
			tx.Rollback()
			return fmt.Errorf("record migration %d: %w", m.Version, err)
		}

		if err := tx.Commit(); err != nil {
			return fmt.Errorf("commit migration %d: %w", m.Version, err)
		}

		slog.Info("migration applied", "version", m.Version)
	}

	return nil
}

func splitStatements(sql string) []string {
	var stmts []string
	current := strings.Builder{}
	for _, line := range strings.Split(sql, "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "--") {
			continue
		}
		current.WriteString(line)
		current.WriteString("\n")
		if strings.HasSuffix(trimmed, ";") {
			stmts = append(stmts, current.String())
			current.Reset()
		}
	}
	if s := strings.TrimSpace(current.String()); s != "" {
		stmts = append(stmts, s)
	}
	return stmts
}
