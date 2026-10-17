package deps

import (
	"testing"

	"github.com/honk/crondeck/internal/store"
)

func str(s string) *string { return &s }

func TestValidateCycle(t *testing.T) {
	a := &store.Job{ID: "a", DependsOn: []string{"b"}}
	b := &store.Job{ID: "b", DependsOn: []string{"a"}}
	by := map[string]*store.Job{"a": a, "b": b}
	if err := Validate("a", []string{"b"}, by); err == nil {
		t.Fatal("expected cycle error")
	}
}

func TestSatisfied(t *testing.T) {
	up := &store.Job{ID: "u", LastStatus: str(store.StatusSuccess)}
	j := &store.Job{ID: "j", DependsOn: []string{"u"}}
	if !Satisfied(j, map[string]*store.Job{"u": up}) {
		t.Fatal("expected satisfied")
	}
	up.LastStatus = str(store.StatusFailed)
	if Satisfied(j, map[string]*store.Job{"u": up}) {
		t.Fatal("expected not satisfied")
	}
}
