package events

import "testing"

func TestCloseAndUnsubscribe(t *testing.T) {
	h := NewHub()
	ch, unsub := h.Subscribe()
	h.Close()
	h.Close()
	unsub()
	unsub()
	if _, ok := <-ch; ok {
		t.Fatal("subscriber not closed")
	}
	h.Publish(RunFinished, "ignored")
	ch, unsub = h.Subscribe()
	unsub()
	if _, ok := <-ch; ok {
		t.Fatal("closed hub accepted subscriber")
	}
}

func TestSummarySubscribersDoNotReceiveLogFlood(t *testing.T) {
	h := NewHub()
	ch, unsub := h.SubscribeUpdates(false)
	defer unsub()
	if h.WantsLogs() {
		t.Fatal("summary stream requested logs")
	}
	for i := 0; i < 1000; i++ {
		h.Publish(RunLog, "noise")
	}
	h.Publish(RunFinished, "done")
	if ev := <-ch; ev.Type != RunFinished {
		t.Fatal("log flood displaced status event")
	}
}
