package executor

import "testing"

func TestSplitSQL(t *testing.T) {
	cases := []struct {
		in   string
		want []string
	}{
		{"SELECT 1;", []string{"SELECT 1"}},
		{"SELECT 1; SELECT 2;", []string{"SELECT 1", "SELECT 2"}},
		{"SELECT 1", []string{"SELECT 1"}},
		{"  ;; SELECT 1 ;; ", []string{"SELECT 1"}},
		{"INSERT INTO t VALUES (';'); SELECT 1;", []string{"INSERT INTO t VALUES (';')", "SELECT 1"}},
		{"SELECT '-- not a comment;';", []string{"SELECT '-- not a comment;'"}},
		{"-- a comment;\nSELECT 1;", []string{"-- a comment;\nSELECT 1"}},
		{"/* block ; */ SELECT 1;", []string{"/* block ; */ SELECT 1"}},
		{"CREATE FUNCTION f() RETURNS int AS $$ BEGIN RETURN 1; END; $$ LANGUAGE plpgsql; SELECT 2;",
			[]string{"CREATE FUNCTION f() RETURNS int AS $$ BEGIN RETURN 1; END; $$ LANGUAGE plpgsql", "SELECT 2"}},
	}
	for _, c := range cases {
		got := splitSQL(c.in)
		if len(got) != len(c.want) {
			t.Fatalf("splitSQL(%q) = %#v, want %#v", c.in, got, c.want)
		}
		for i := range got {
			if got[i] != c.want[i] {
				t.Fatalf("splitSQL(%q)[%d] = %q, want %q", c.in, i, got[i], c.want[i])
			}
		}
	}
}

func TestIsRowReturning(t *testing.T) {
	rows := []string{"SELECT 1", "  select * from t", "WITH x AS (…) SELECT 1", "PRAGMA table_info(t)",
		"INSERT INTO t VALUES (1) RETURNING id", "explain analyze select 1"}
	for _, s := range rows {
		if !isRowReturning(s) {
			t.Errorf("expected row-returning: %q", s)
		}
	}
	exec := []string{"INSERT INTO t VALUES (1)", "UPDATE t SET a=1", "DELETE FROM t", "CREATE TABLE t (a int)", "DROP TABLE t"}
	for _, s := range exec {
		if isRowReturning(s) {
			t.Errorf("expected exec (no rows): %q", s)
		}
	}
}
