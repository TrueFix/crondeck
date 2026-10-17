// Package executor runs a single job attempt. Each job type implements Executor.
package executor

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"

	"github.com/honk/crondeck/internal/store"
)

// Result is what an executor reports. The runner decides the final status
// (it overrides with timeout/cancelled when the context was the cause).
type Result struct {
	OK         bool
	ExitCode   *int
	HTTPStatus *int
	Error      string
}

// LogFunc receives output chunks as they are produced (for live streaming).
type LogFunc func(chunk string)

type Executor interface {
	// Validate checks the job's type-specific config.
	Validate(cfg json.RawMessage) error
	// Run executes one attempt, writing output to out.
	Run(ctx context.Context, job *store.Job, out *Output) Result
}

// Registry maps job types to executors.
type Registry map[string]Executor

func DefaultRegistry() Registry {
	return Registry{
		store.TypeHTTP:   &HTTP{},
		store.TypeShell:  &Shell{},
		store.TypeScript: &Script{},
		store.TypeSQL:    &SQL{},
	}
}

func (r Registry) Get(t string) (Executor, error) {
	e, ok := r[t]
	if !ok {
		return nil, fmt.Errorf("unknown job type %q", t)
	}
	return e, nil
}

// ---------------------------------------------------------------- output capture

// Output is an io.Writer that keeps the first and last max/2 bytes (so both the
// start and the end of long logs survive) and forwards chunks to a live sink.
type Output struct {
	mu        sync.Mutex
	max       int
	head      []byte
	tail      []byte
	truncated int
	sink      LogFunc
}

func NewOutput(max int, sink LogFunc) *Output {
	if max < 1024 {
		max = 1024
	}
	return &Output{max: max, sink: sink}
}

func (o *Output) Write(p []byte) (int, error) {
	o.mu.Lock()
	half := o.max / 2
	n := len(p)
	data := p
	if room := half - len(o.head); room > 0 {
		k := min(room, len(data))
		o.head = append(o.head, data[:k]...)
		data = data[k:]
	}
	if len(data) > 0 {
		o.tail = append(o.tail, data...)
		if over := len(o.tail) - half; over > 0 {
			o.truncated += over
			o.tail = append(o.tail[:0:0], o.tail[over:]...)
		}
	}
	sink := o.sink
	o.mu.Unlock()
	if sink != nil && n > 0 {
		chunk := p
		if len(chunk) > 8192 {
			chunk = chunk[len(chunk)-8192:]
		}
		sink(string(chunk))
	}
	return n, nil
}

func (o *Output) WriteString(s string) { _, _ = o.Write([]byte(s)) }

func (o *Output) String() string {
	o.mu.Lock()
	defer o.mu.Unlock()
	var b strings.Builder
	b.Write(o.head)
	if o.truncated > 0 {
		fmt.Fprintf(&b, "\n\n… [%d bytes truncated] …\n\n", o.truncated)
	}
	b.Write(o.tail)
	return strings.ToValidUTF8(b.String(), "\uFFFD")
}

func intPtr(v int) *int { return &v }
