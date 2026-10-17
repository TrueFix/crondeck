// Package events is a tiny in-process pub/sub hub used to fan out live updates to SSE clients.
package events

import (
	"sync"
	"sync/atomic"
)

const (
	RunQueued   = "run.queued"
	RunStarted  = "run.started"
	RunFinished = "run.finished"
	RunLog      = "run.log"
	JobUpdated  = "job.updated"
	JobDeleted  = "job.deleted"
)

type Event struct {
	Type string `json:"type"`
	Data any    `json:"data"`
}

type Hub struct {
	mu      sync.RWMutex
	subs    map[uint64]subscription
	next    uint64
	dropped atomic.Uint64
	closed  bool
}

type subscription struct {
	ch   chan Event
	logs bool
}

func NewHub() *Hub { return &Hub{subs: map[uint64]subscription{}} }

// Subscribe returns a buffered channel and an unsubscribe func (safe to call twice).
func (h *Hub) Subscribe() (<-chan Event, func()) {
	return h.SubscribeUpdates(true)
}

func (h *Hub) SubscribeUpdates(logs bool) (<-chan Event, func()) {
	ch := make(chan Event, 256)
	h.mu.Lock()
	if h.closed {
		close(ch)
		h.mu.Unlock()
		return ch, func() {}
	}
	h.next++
	id := h.next
	h.subs[id] = subscription{ch: ch, logs: logs}
	h.mu.Unlock()
	var once sync.Once
	return ch, func() {
		once.Do(func() {
			h.mu.Lock()
			if _, ok := h.subs[id]; ok {
				delete(h.subs, id)
				close(ch)
			}
			h.mu.Unlock()
		})
	}
}

// Close ends SSE streams before HTTP shutdown, so open dashboards do not consume the entire grace period.
func (h *Hub) Close() {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.closed = true
	for id, sub := range h.subs {
		delete(h.subs, id)
		close(sub.ch)
	}
}

// Publish never blocks: slow subscribers miss events rather than stalling job execution.
func (h *Hub) Publish(typ string, data any) {
	ev := Event{Type: typ, Data: data}
	h.mu.RLock()
	defer h.mu.RUnlock()
	for _, sub := range h.subs {
		if typ == RunLog && !sub.logs {
			continue
		}
		select {
		case sub.ch <- ev:
		default:
			h.dropped.Add(1)
		}
	}
}

func (h *Hub) WantsLogs() bool {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for _, sub := range h.subs {
		if sub.logs {
			return true
		}
	}
	return false
}

func (h *Hub) Subscribers() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.subs)
}
