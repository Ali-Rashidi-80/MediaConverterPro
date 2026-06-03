"""ConversionTaskQueue unit tests."""
from __future__ import annotations

from galaxy.workers.task_queue import ConversionTaskQueue


def test_append_and_take_fifo():
    q = ConversionTaskQueue(["a", "b"])
    assert q.take_next() == "a"
    assert q.take_next() == "b"
    assert q.take_next() is None


def test_append_dedupes_pending():
    q = ConversionTaskQueue(["a"])
    added = q.append(["a", "b", "b"])
    assert added == ["b"]
    assert q.total == 2


def test_request_stop_clears_pending():
    q = ConversionTaskQueue(["a", "b", "c"])
    q.request_stop()
    assert q.is_stopped()
    assert q.take_next() is None
    assert q.pending_count() == 0


def test_mark_complete_increments():
    q = ConversionTaskQueue(["a", "b"])
    q.mark_complete()
    assert q.completed == 1
    assert q.total == 2


def test_discard_pending():
    q = ConversionTaskQueue(["a", "b", "c"])
    assert q.discard_pending("b") is True
    assert q.total == 2
    assert q.take_next() == "a"
    assert q.take_next() == "c"
    assert q.discard_pending("missing") is False


def test_discard_pending_keeps_total_above_completed():
    q = ConversionTaskQueue(["a", "b"])
    q.mark_complete()
    assert q.discard_pending("b") is True
    assert q.total == 1
    assert q.completed == 1
